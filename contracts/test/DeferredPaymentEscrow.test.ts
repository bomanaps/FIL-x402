import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("DeferredPaymentEscrow", function () {
  async function deployFixture() {
    const [owner, buyer, seller, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("USD for Filecoin Community", "USDFC", 18);

    const Escrow = await ethers.getContractFactory("DeferredPaymentEscrow");
    const escrow = await Escrow.deploy(await token.getAddress());

    // Mint tokens to buyer
    const mintAmount = ethers.parseEther("10000");
    await token.mint(buyer.address, mintAmount);
    await token.connect(buyer).approve(await escrow.getAddress(), mintAmount);

    const escrowAddress = await escrow.getAddress();
    const tokenAddress = await token.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    return { escrow, token, owner, buyer, seller, other, escrowAddress, tokenAddress, chainId };
  }

  // Helper to sign a voucher using EIP-712
  async function signVoucher(
    escrow: any,
    signer: any,
    voucher: {
      id: string;
      buyer: string;
      seller: string;
      valueAggregate: bigint;
      asset: string;
      timestamp: number;
      nonce: number;
      escrowAddr: string;
      chainId: bigint;
    }
  ) {
    const domain = {
      name: "DeferredPaymentEscrow",
      version: "1",
      chainId: voucher.chainId,
      verifyingContract: voucher.escrowAddr,
    };

    const types = {
      Voucher: [
        { name: "id", type: "bytes32" },
        { name: "buyer", type: "address" },
        { name: "seller", type: "address" },
        { name: "valueAggregate", type: "uint256" },
        { name: "asset", type: "address" },
        { name: "timestamp", type: "uint64" },
        { name: "nonce", type: "uint256" },
        { name: "escrow", type: "address" },
        { name: "chainId", type: "uint256" },
      ],
    };

    const value = {
      id: voucher.id,
      buyer: voucher.buyer,
      seller: voucher.seller,
      valueAggregate: voucher.valueAggregate,
      asset: voucher.asset,
      timestamp: voucher.timestamp,
      nonce: voucher.nonce,
      escrow: voucher.escrowAddr,
      chainId: voucher.chainId,
    };

    return signer.signTypedData(domain, types, value);
  }

  function makeVoucherId(label: string): string {
    return ethers.id(label);
  }

  describe("Deposit", function () {
    it("should accept deposits", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await escrow.connect(buyer).deposit(amount);

      const acct = await escrow.getAccount(buyer.address);
      expect(acct.balance).to.equal(amount);
    });

    it("should emit Deposited event", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await expect(escrow.connect(buyer).deposit(amount))
        .to.emit(escrow, "Deposited")
        .withArgs(buyer.address, amount);
    });

    it("should reject zero deposit", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await expect(escrow.connect(buyer).deposit(0)).to.be.revertedWith("zero amount");
    });

    it("should accumulate deposits", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("500"));
      await escrow.connect(buyer).deposit(ethers.parseEther("300"));

      const acct = await escrow.getAccount(buyer.address);
      expect(acct.balance).to.equal(ethers.parseEther("800"));
    });
  });

  describe("Thaw / Withdraw", function () {
    it("should start thawing", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      await expect(escrow.connect(buyer).thaw(ethers.parseEther("500")))
        .to.emit(escrow, "ThawStarted");

      const acct = await escrow.getAccount(buyer.address);
      expect(acct.thawingAmount).to.equal(ethers.parseEther("500"));
      expect(acct.thawEndTime).to.be.gt(0);
    });

    it("should reject thaw exceeding balance", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await escrow.connect(buyer).deposit(ethers.parseEther("100"));

      await expect(escrow.connect(buyer).thaw(ethers.parseEther("200")))
        .to.be.revertedWith("exceeds balance");
    });

    it("should allow withdraw after thaw period", async function () {
      const { escrow, token, buyer } = await loadFixture(deployFixture);
      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      await escrow.connect(buyer).thaw(ethers.parseEther("500"));

      // Advance 1 day
      await time.increase(86401);

      const balBefore = await token.balanceOf(buyer.address);
      await escrow.connect(buyer).withdraw();
      const balAfter = await token.balanceOf(buyer.address);

      expect(balAfter - balBefore).to.equal(ethers.parseEther("500"));

      const acct = await escrow.getAccount(buyer.address);
      expect(acct.balance).to.equal(ethers.parseEther("500"));
      expect(acct.thawingAmount).to.equal(0n);
    });

    it("should reject withdraw before thaw completes", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      await escrow.connect(buyer).thaw(ethers.parseEther("500"));

      await expect(escrow.connect(buyer).withdraw())
        .to.be.revertedWith("thaw not complete");
    });

    it("should reject withdraw with nothing thawing", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      await expect(escrow.connect(buyer).withdraw())
        .to.be.revertedWith("nothing thawing");
    });
  });

  describe("Collect", function () {
    it("should collect a valid voucher", async function () {
      const { escrow, token, buyer, seller, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      const voucherId = makeVoucherId("voucher-1");
      const amount = ethers.parseEther("50");
      const now = Math.floor(Date.now() / 1000);

      const sig = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: amount,
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      const balBefore = await token.balanceOf(seller.address);

      await expect(
        escrow.collect(
          {
            id: voucherId,
            buyer: buyer.address,
            seller: seller.address,
            valueAggregate: amount,
            asset: tokenAddress,
            timestamp: now,
            nonce: 1,
            escrow: escrowAddress,
            chainId,
          },
          sig
        )
      )
        .to.emit(escrow, "Collected")
        .withArgs(voucherId, buyer.address, seller.address, amount);

      const balAfter = await token.balanceOf(seller.address);
      expect(balAfter - balBefore).to.equal(amount);

      // Buyer balance reduced
      const acct = await escrow.getAccount(buyer.address);
      expect(acct.balance).to.equal(ethers.parseEther("950"));
    });

    it("should enforce monotonic valueAggregate", async function () {
      const { escrow, buyer, seller, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      const voucherId = makeVoucherId("voucher-2");
      const now = Math.floor(Date.now() / 1000);

      // First collect: 100
      const sig1 = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("100"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      await escrow.collect(
        {
          id: voucherId,
          buyer: buyer.address,
          seller: seller.address,
          valueAggregate: ethers.parseEther("100"),
          asset: tokenAddress,
          timestamp: now,
          nonce: 1,
          escrow: escrowAddress,
          chainId,
        },
        sig1
      );

      // Second collect with same valueAggregate should fail
      const sig2 = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("100"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 2,
        escrowAddr: escrowAddress,
        chainId,
      });

      await expect(
        escrow.collect(
          {
            id: voucherId,
            buyer: buyer.address,
            seller: seller.address,
            valueAggregate: ethers.parseEther("100"),
            asset: tokenAddress,
            timestamp: now,
            nonce: 2,
            escrow: escrowAddress,
            chainId,
          },
          sig2
        )
      ).to.be.revertedWith("value not increasing");
    });

    it("should pay only delta on subsequent collects", async function () {
      const { escrow, token, buyer, seller, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      const voucherId = makeVoucherId("voucher-3");
      const now = Math.floor(Date.now() / 1000);

      // First: valueAggregate = 100
      const sig1 = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("100"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });
      await escrow.collect(
        {
          id: voucherId,
          buyer: buyer.address,
          seller: seller.address,
          valueAggregate: ethers.parseEther("100"),
          asset: tokenAddress,
          timestamp: now,
          nonce: 1,
          escrow: escrowAddress,
          chainId,
        },
        sig1
      );

      // Second: valueAggregate = 250 → delta = 150
      const sig2 = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("250"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 2,
        escrowAddr: escrowAddress,
        chainId,
      });

      const balBefore = await token.balanceOf(seller.address);
      await escrow.collect(
        {
          id: voucherId,
          buyer: buyer.address,
          seller: seller.address,
          valueAggregate: ethers.parseEther("250"),
          asset: tokenAddress,
          timestamp: now,
          nonce: 2,
          escrow: escrowAddress,
          chainId,
        },
        sig2
      );
      const balAfter = await token.balanceOf(seller.address);

      // Seller should receive only the delta (150)
      expect(balAfter - balBefore).to.equal(ethers.parseEther("150"));
    });

    it("should reject stale nonce", async function () {
      const { escrow, buyer, seller, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      const voucherId = makeVoucherId("voucher-4");
      const now = Math.floor(Date.now() / 1000);

      // Collect with nonce 2
      const sig1 = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("100"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 2,
        escrowAddr: escrowAddress,
        chainId,
      });
      await escrow.collect(
        {
          id: voucherId,
          buyer: buyer.address,
          seller: seller.address,
          valueAggregate: ethers.parseEther("100"),
          asset: tokenAddress,
          timestamp: now,
          nonce: 2,
          escrow: escrowAddress,
          chainId,
        },
        sig1
      );

      // Try nonce 1 (stale)
      const sig2 = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("200"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      await expect(
        escrow.collect(
          {
            id: voucherId,
            buyer: buyer.address,
            seller: seller.address,
            valueAggregate: ethers.parseEther("200"),
            asset: tokenAddress,
            timestamp: now,
            nonce: 1,
            escrow: escrowAddress,
            chainId,
          },
          sig2
        )
      ).to.be.revertedWith("stale nonce");
    });

    it("should reject invalid signature", async function () {
      const { escrow, buyer, seller, other, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      const voucherId = makeVoucherId("voucher-5");
      const now = Math.floor(Date.now() / 1000);

      // Sign with `other` instead of `buyer`
      const sig = await signVoucher(escrow, other, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("100"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      await expect(
        escrow.collect(
          {
            id: voucherId,
            buyer: buyer.address,
            seller: seller.address,
            valueAggregate: ethers.parseEther("100"),
            asset: tokenAddress,
            timestamp: now,
            nonce: 1,
            escrow: escrowAddress,
            chainId,
          },
          sig
        )
      ).to.be.revertedWith("invalid signature");
    });

    it("should reject if insufficient escrow balance", async function () {
      const { escrow, buyer, seller, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      // Deposit only 10
      await escrow.connect(buyer).deposit(ethers.parseEther("10"));

      const voucherId = makeVoucherId("voucher-6");
      const now = Math.floor(Date.now() / 1000);

      const sig = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("100"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      await expect(
        escrow.collect(
          {
            id: voucherId,
            buyer: buyer.address,
            seller: seller.address,
            valueAggregate: ethers.parseEther("100"),
            asset: tokenAddress,
            timestamp: now,
            nonce: 1,
            escrow: escrowAddress,
            chainId,
          },
          sig
        )
      ).to.be.revertedWith("insufficient escrow balance");
    });
  });

  describe("CollectMany", function () {
    it("should batch collect multiple vouchers", async function () {
      const { escrow, token, buyer, seller, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("1000"));

      const now = Math.floor(Date.now() / 1000);

      const v1Id = makeVoucherId("batch-v1");
      const v2Id = makeVoucherId("batch-v2");

      const sig1 = await signVoucher(escrow, buyer, {
        id: v1Id,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("50"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      const sig2 = await signVoucher(escrow, buyer, {
        id: v2Id,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("75"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      const balBefore = await token.balanceOf(seller.address);

      await escrow.collectMany(
        [
          {
            id: v1Id,
            buyer: buyer.address,
            seller: seller.address,
            valueAggregate: ethers.parseEther("50"),
            asset: tokenAddress,
            timestamp: now,
            nonce: 1,
            escrow: escrowAddress,
            chainId,
          },
          {
            id: v2Id,
            buyer: buyer.address,
            seller: seller.address,
            valueAggregate: ethers.parseEther("75"),
            asset: tokenAddress,
            timestamp: now,
            nonce: 1,
            escrow: escrowAddress,
            chainId,
          },
        ],
        [sig1, sig2]
      );

      const balAfter = await token.balanceOf(seller.address);
      expect(balAfter - balBefore).to.equal(ethers.parseEther("125"));
    });
  });

  describe("Thaw clamping after collect", function () {
    it("should clamp thawing amount if collect reduces balance below it", async function () {
      const { escrow, buyer, seller, escrowAddress, tokenAddress, chainId } =
        await loadFixture(deployFixture);

      await escrow.connect(buyer).deposit(ethers.parseEther("100"));

      // Thaw the full 100
      await escrow.connect(buyer).thaw(ethers.parseEther("100"));

      // Collect 80 via voucher — should clamp thawing to 20
      const voucherId = makeVoucherId("thaw-clamp");
      const now = Math.floor(Date.now() / 1000);

      const sig = await signVoucher(escrow, buyer, {
        id: voucherId,
        buyer: buyer.address,
        seller: seller.address,
        valueAggregate: ethers.parseEther("80"),
        asset: tokenAddress,
        timestamp: now,
        nonce: 1,
        escrowAddr: escrowAddress,
        chainId,
      });

      await escrow.collect(
        {
          id: voucherId,
          buyer: buyer.address,
          seller: seller.address,
          valueAggregate: ethers.parseEther("80"),
          asset: tokenAddress,
          timestamp: now,
          nonce: 1,
          escrow: escrowAddress,
          chainId,
        },
        sig
      );

      const acct = await escrow.getAccount(buyer.address);
      expect(acct.balance).to.equal(ethers.parseEther("20"));
      expect(acct.thawingAmount).to.equal(ethers.parseEther("20"));
    });
  });
});
