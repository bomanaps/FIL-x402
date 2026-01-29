import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("BondedFacilitator", function () {
  async function deployFixture() {
    const [owner, provider, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("USD for Filecoin Community", "USDFC", 18);

    const BondedFacilitator = await ethers.getContractFactory("BondedFacilitator");
    const bond = await BondedFacilitator.deploy(await token.getAddress());

    // Mint tokens to owner
    const mintAmount = ethers.parseEther("100000"); // 100k USDFC
    await token.mint(owner.address, mintAmount);
    await token.approve(await bond.getAddress(), mintAmount);

    return { bond, token, owner, provider, other };
  }

  describe("Bond Management", function () {
    it("should accept bond deposits", async function () {
      const { bond, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await bond.depositBond(amount);

      expect(await bond.bondBalance(owner.address)).to.equal(amount);
    });

    it("should emit BondDeposited event", async function () {
      const { bond, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await expect(bond.depositBond(amount))
        .to.emit(bond, "BondDeposited")
        .withArgs(owner.address, amount);
    });

    it("should reject zero deposit", async function () {
      const { bond } = await loadFixture(deployFixture);
      await expect(bond.depositBond(0)).to.be.revertedWith("zero amount");
    });

    it("should allow withdrawal of uncommitted bond", async function () {
      const { bond, token, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await bond.depositBond(amount);

      const balBefore = await token.balanceOf(owner.address);
      await bond.withdrawBond(amount);
      const balAfter = await token.balanceOf(owner.address);

      expect(balAfter - balBefore).to.equal(amount);
      expect(await bond.bondBalance(owner.address)).to.equal(0);
    });

    it("should reject withdrawal exceeding available bond", async function () {
      const { bond, provider } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1000");

      await bond.depositBond(amount);

      // Commit half
      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("600"));

      // Try to withdraw more than available (1000 - 600 = 400 available)
      await expect(bond.withdrawBond(ethers.parseEther("500")))
        .to.be.revertedWith("exceeds available bond");
    });
  });

  describe("Payment Lifecycle", function () {
    it("should commit a payment", async function () {
      const { bond, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      const amount = ethers.parseEther("100");

      await expect(bond.commitPayment(paymentId, provider.address, amount))
        .to.emit(bond, "PaymentCommitted")
        .withArgs(paymentId, provider.address, amount);

      const payment = await bond.payments(paymentId);
      expect(payment.provider).to.equal(provider.address);
      expect(payment.amount).to.equal(amount);
      expect(payment.settled).to.be.false;
      expect(payment.claimed).to.be.false;
    });

    it("should track exposure correctly", async function () {
      const { bond, owner, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      await bond.commitPayment(ethers.id("p1"), provider.address, ethers.parseEther("100"));
      await bond.commitPayment(ethers.id("p2"), provider.address, ethers.parseEther("200"));

      expect(await bond.getExposure(owner.address)).to.equal(ethers.parseEther("300"));
      expect(await bond.getAvailableBond(owner.address)).to.equal(ethers.parseEther("700"));
    });

    it("should reject commitment exceeding available bond", async function () {
      const { bond, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("100"));

      await expect(
        bond.commitPayment(ethers.id("p1"), provider.address, ethers.parseEther("200"))
      ).to.be.revertedWith("insufficient bond");
    });

    it("should reject duplicate payment ID", async function () {
      const { bond, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("100"));

      await expect(
        bond.commitPayment(paymentId, provider.address, ethers.parseEther("50"))
      ).to.be.revertedWith("payment exists");
    });

    it("should release payment and free bond", async function () {
      const { bond, owner, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("100"));

      await expect(bond.releasePayment(paymentId))
        .to.emit(bond, "PaymentReleased")
        .withArgs(paymentId);

      expect(await bond.getExposure(owner.address)).to.equal(0);
      expect(await bond.getAvailableBond(owner.address)).to.equal(ethers.parseEther("1000"));

      const payment = await bond.payments(paymentId);
      expect(payment.settled).to.be.true;
    });

    it("should only allow facilitator to release", async function () {
      const { bond, provider, other } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("100"));

      await expect(bond.connect(other).releasePayment(paymentId))
        .to.be.revertedWith("not facilitator");
    });
  });

  describe("Provider Claims", function () {
    it("should allow provider to claim after timeout", async function () {
      const { bond, token, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      const amount = ethers.parseEther("100");
      await bond.commitPayment(paymentId, provider.address, amount);

      // Advance time past 10-minute deadline
      await time.increase(601);

      const balBefore = await token.balanceOf(provider.address);
      await expect(bond.connect(provider).claimPayment(paymentId))
        .to.emit(bond, "PaymentClaimed")
        .withArgs(paymentId, provider.address, amount);
      const balAfter = await token.balanceOf(provider.address);

      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should reject claim before timeout", async function () {
      const { bond, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("100"));

      await expect(bond.connect(provider).claimPayment(paymentId))
        .to.be.revertedWith("deadline not reached");
    });

    it("should reject claim from non-provider", async function () {
      const { bond, provider, other } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("100"));

      await time.increase(601);

      await expect(bond.connect(other).claimPayment(paymentId))
        .to.be.revertedWith("not provider");
    });

    it("should reject claim on already settled payment", async function () {
      const { bond, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("100"));

      // Settle it
      await bond.releasePayment(paymentId);

      await time.increase(601);

      await expect(bond.connect(provider).claimPayment(paymentId))
        .to.be.revertedWith("already resolved");
    });

    it("should reduce bond balance after claim", async function () {
      const { bond, owner, provider } = await loadFixture(deployFixture);
      await bond.depositBond(ethers.parseEther("1000"));

      const paymentId = ethers.id("payment-1");
      await bond.commitPayment(paymentId, provider.address, ethers.parseEther("100"));

      await time.increase(601);
      await bond.connect(provider).claimPayment(paymentId);

      // Bond balance should decrease by claimed amount
      expect(await bond.bondBalance(owner.address)).to.equal(ethers.parseEther("900"));
      expect(await bond.getExposure(owner.address)).to.equal(0);
    });
  });
});
