# FCR-x402 Facilitator API

## Base URL

```
http://localhost:3402
```

---

## Endpoints

### `POST /verify`

Verify a payment before accepting it. Checks signature, balance, nonce, validity window, and risk limits.

**Request Body:**

```json
{
  "payment": {
    "token": "0x...",          // USDFC contract address
    "from": "0x...",           // Payer address
    "to": "0x...",             // Provider address
    "value": "1000000",        // Amount in smallest unit (6 decimals)
    "validAfter": 1700000000,  // Unix timestamp
    "validBefore": 1700003600, // Unix timestamp
    "nonce": "0x...",          // 32-byte hex nonce
    "signature": "0x..."       // EIP-712 signature (65 bytes)
  },
  "requirements": {
    "payTo": "0x...",              // Expected recipient
    "maxAmountRequired": "1000000", // Required amount
    "tokenAddress": "0x...",        // Expected token
    "chainId": 314159,              // Chain ID
    "resource": "/api/data",        // Optional: resource being purchased
    "description": "API access"     // Optional: description
  }
}
```

**Response (200 OK):**

```json
{
  "valid": true,
  "riskScore": 0,
  "walletBalance": "5000000",
  "pendingAmount": "0"
}
```

**Response (400 Bad Request):**

```json
{
  "valid": false,
  "riskScore": 100,
  "reason": "invalid_signature"
}
```

**Rejection Reasons:**

| Reason | Description |
|--------|-------------|
| `token_mismatch` | Payment token doesn't match requirements |
| `recipient_mismatch` | Payment recipient doesn't match requirements |
| `insufficient_amount` | Payment amount less than required |
| `invalid_signature` | EIP-712 signature verification failed |
| `expired_or_not_yet_valid` | Outside validity window |
| `expires_too_soon` | Less than 2 minutes until expiry |
| `nonce_already_used` | Nonce was used in a previous payment |
| `insufficient_balance` | Wallet balance below payment amount |
| `balance_check_failed` | Could not check balance (RPC error) |
| Risk limit exceeded | See risk limits section |

---

### `POST /settle`

Submit a verified payment for on-chain settlement.

**Request Body:** Same as `/verify`

**Response (200 OK):**

```json
{
  "success": true,
  "paymentId": "0x...",       // Unique payment identifier
  "transactionCid": "0x..."   // Filecoin transaction CID
}
```

**Response (400 Bad Request):**

```json
{
  "success": false,
  "paymentId": "0x...",
  "error": "payment_already_submitted"
}
```

---

### `GET /settle/:paymentId`

Get the status of a submitted settlement.

**Response:**

```json
{
  "paymentId": "0x...",
  "status": "submitted",      // pending | submitted | confirmed | failed | retry
  "transactionCid": "0x...",
  "attempts": 1,
  "createdAt": 1700000000000,
  "updatedAt": 1700000001000,
  "error": null
}
```

---

### `GET /health`

Health check endpoint.

**Response (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "chain": {
    "id": 314159,
    "name": "calibration",
    "connected": true
  },
  "settlements": {
    "pending": 5,
    "totalPendingAmount": "5000000",
    "walletsWithPending": 3
  },
  "limits": {
    "maxPerTransaction": "100000000",
    "maxPendingPerWallet": "50000000",
    "dailyLimitPerWallet": "500000000"
  }
}
```

---

## EIP-3009 Signature

Payments use EIP-3009 `transferWithAuthorization` signatures. The client must sign an EIP-712 typed data message:

**Domain:**
```json
{
  "name": "USD Coin",
  "version": "1",
  "chainId": 314159,
  "verifyingContract": "<USDFC_ADDRESS>"
}
```

**Types:**
```json
{
  "TransferWithAuthorization": [
    { "name": "from", "type": "address" },
    { "name": "to", "type": "address" },
    { "name": "value", "type": "uint256" },
    { "name": "validAfter", "type": "uint256" },
    { "name": "validBefore", "type": "uint256" },
    { "name": "nonce", "type": "bytes32" }
  ]
}
```

**Example (ethers.js v6):**
```typescript
const signature = await wallet.signTypedData(domain, types, {
  from: wallet.address,
  to: providerAddress,
  value: amount,
  validAfter: Math.floor(Date.now() / 1000) - 60,
  validBefore: Math.floor(Date.now() / 1000) + 3600,
  nonce: ethers.hexlify(ethers.randomBytes(32)),
});
```

---

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 200 | Success |
| 400 | Validation failed (invalid payment) |
| 404 | Settlement not found |
| 500 | Internal server error |
