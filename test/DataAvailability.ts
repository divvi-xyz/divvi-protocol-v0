import { expect } from 'chai'
import hre from 'hardhat'

const CONTRACT_NAME = 'DataAvailability'

function sumBuffersModulo(buffer1: Buffer, buffer2: Buffer) {
  const buffer1BigInt = BigInt('0x' + buffer1.toString('hex'))
  const buffer2BigInt = BigInt('0x' + buffer2.toString('hex'))

  const result = (buffer1BigInt + buffer2BigInt) % (2n ** 256n - 189n) // Commonly used safe prime

  return Buffer.from(result.toString(16), 'hex')
}

describe('DataAvailability', () => {
  const UPLOADER_ROLE = hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes('UPLOADER_ROLE'),
  )

  async function deployDataAvailabilityContract() {
    const [owner, uploader, extraUser] = await hre.ethers.getSigners()

    // Deploy a mock RISC Zero verifier contract
    const MockVerifier = await hre.ethers.getContractFactory('MockVerifier')
    const mockVerifier = await MockVerifier.deploy()
    await mockVerifier.waitForDeployment()

    // Deploy the DataAvailability contract with the mock verifier
    const DataAvailability = await hre.ethers.getContractFactory(CONTRACT_NAME)
    const dataAvailability = await DataAvailability.deploy(
      owner.address,
      hre.ethers.ZeroHash, // imageID - using zero hash for testing
      await mockVerifier.getAddress(), // verifier address
    )

    return { dataAvailability, owner, uploader, extraUser, mockVerifier }
  }

  describe('Deployment', () => {
    it('should set the deployer as the default admin', async () => {
      const { dataAvailability, owner } = await deployDataAvailabilityContract()
      expect(
        await dataAvailability.hasRole(
          await dataAvailability.DEFAULT_ADMIN_ROLE(),
          owner.address,
        ),
      ).to.be.true
    })

    it('should set the deployer as an uploader', async () => {
      const { dataAvailability, owner } = await deployDataAvailabilityContract()
      expect(await dataAvailability.hasRole(UPLOADER_ROLE, owner.address)).to.be
        .true
    })
  })

  describe('Role Management', () => {
    it('should allow admin to grant uploader role', async () => {
      const { dataAvailability, uploader } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)
      expect(await dataAvailability.hasRole(UPLOADER_ROLE, uploader.address)).to
        .be.true
    })

    it('should allow admin to revoke uploader role', async () => {
      const { dataAvailability, uploader } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)
      await dataAvailability.revokeUploaderRole(uploader.address)
      expect(await dataAvailability.hasRole(UPLOADER_ROLE, uploader.address)).to
        .be.false
    })

    it('should not allow non-admin to grant uploader role', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await expect(
        (
          dataAvailability.connect(uploader) as typeof dataAvailability
        ).grantUploaderRole(extraUser.address),
      ).to.be.revertedWithCustomError(
        dataAvailability,
        'AccessControlUnauthorizedAccount',
      )
    })

    it('should not allow revoking uploader role from owner', async () => {
      const { dataAvailability, owner } = await deployDataAvailabilityContract()
      await expect(dataAvailability.revokeUploaderRole(owner.address))
        .to.be.revertedWithCustomError(
          dataAvailability,
          'CannotRemoveUploaderFromOwner',
        )
        .withArgs(owner.address)
    })
  })

  describe('Data Upload', () => {
    beforeEach(async () => {})

    it('should allow uploader to upload data', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      await expect(
        (
          dataAvailability.connect(uploader) as typeof dataAvailability
        ).uploadData(timestamp, users, values),
      ).to.not.be.reverted
    })

    it('should allow multiple uploads for different users at the same timestamp', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)

      // First upload for user1
      const users1 = [extraUser.address]
      const values1 = [100]
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users1, values1)

      // Second upload for user2 at the same timestamp
      const users2 = [uploader.address]
      const values2 = [200]
      await expect(
        (
          dataAvailability.connect(uploader) as typeof dataAvailability
        ).uploadData(timestamp, users2, values2),
      ).to.not.be.reverted

      // Verify both users have the timestamp as their last timestamp
      expect(
        await dataAvailability.getLastTimestamp(extraUser.address),
      ).to.equal(timestamp)
      expect(
        await dataAvailability.getLastTimestamp(uploader.address),
      ).to.equal(timestamp)

      // Verify the hash is non-zero (indicating data was stored)
      const hash = await dataAvailability.getHash(timestamp)
      expect(hash).to.not.equal(hre.ethers.ZeroHash)
    })

    it('should not allow duplicate uploads for the same user at the same timestamp', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)

      // First upload for the user
      const users = [extraUser.address]
      const values1 = [100]
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values1)

      // Attempt to upload again for the same user at the same timestamp
      const values2 = [200]
      await expect(
        (
          dataAvailability.connect(uploader) as typeof dataAvailability
        ).uploadData(timestamp, users, values2),
      )
        .to.be.revertedWithCustomError(
          dataAvailability,
          'UserHasDataAtTimestamp',
        )
        .withArgs(extraUser.address, timestamp)

      // Verify the user's last timestamp is still correct
      expect(
        await dataAvailability.getLastTimestamp(extraUser.address),
      ).to.equal(timestamp)
    })

    it('should not allow non-uploader to upload data', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      await expect(
        (
          dataAvailability.connect(extraUser) as typeof dataAvailability
        ).uploadData(timestamp, users, values),
      ).to.be.revertedWithCustomError(
        dataAvailability,
        'AccessControlUnauthorizedAccount',
      )
    })

    it('should require timestamp to be greater than most recent', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp1 = Math.floor(Date.now() / 1000)
      const timestamp2 = timestamp1 - 1
      const users = [extraUser.address]
      const values = [100]

      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp1, users, values)
      await expect(
        (
          dataAvailability.connect(uploader) as typeof dataAvailability
        ).uploadData(timestamp2, users, values),
      )
        .to.be.revertedWithCustomError(dataAvailability, 'TimestampTooEarly')
        .withArgs(timestamp2, timestamp1)
    })

    it('should calculate correct rolling hash', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address, uploader.address]
      const values = [100, 200]
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)

      const hash1 = hre.ethers.keccak256(
        hre.ethers.solidityPacked(
          ['address', 'uint256'],
          [extraUser.address, 100],
        ),
      )
      const hash2 = hre.ethers.keccak256(
        hre.ethers.solidityPacked(
          ['address', 'uint256'],
          [uploader.address, 200],
        ),
      )
      const expectedHash = `0x${sumBuffersModulo(Buffer.from(hash1.slice(2), 'hex'), Buffer.from(hash2.slice(2), 'hex')).toString('hex')}`

      const hash = await dataAvailability.getHash(timestamp)
      expect(hash).to.equal(expectedHash)
    })
    it('hash calculation should be commutative', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      // Same as above, but in reverse order
      const timestamp = Math.floor(Date.now() / 1000)
      const users = [uploader.address, extraUser.address]
      const values = [200, 100]
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)

      const hash1 = hre.ethers.keccak256(
        hre.ethers.solidityPacked(
          ['address', 'uint256'],
          [extraUser.address, 100],
        ),
      )
      const hash2 = hre.ethers.keccak256(
        hre.ethers.solidityPacked(
          ['address', 'uint256'],
          [uploader.address, 200],
        ),
      )
      const expectedHash = `0x${sumBuffersModulo(Buffer.from(hash1.slice(2), 'hex'), Buffer.from(hash2.slice(2), 'hex')).toString('hex')}`

      const hash = await dataAvailability.getHash(timestamp)
      expect(hash).to.equal(expectedHash)
    })
  })

  describe('Data Retrieval', () => {
    it('should return zero hash for non-existent timestamp', async () => {
      const { dataAvailability, uploader } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const hash = await dataAvailability.getHash(1234567890)
      expect(hash).to.equal(hre.ethers.ZeroHash)
    })

    it('should return correct hash for existing timestamp', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)
      const hash = await dataAvailability.getHash(timestamp)
      expect(hash).to.not.equal(hre.ethers.ZeroHash)
    })

    it('should track user last timestamp', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)
      expect(
        await dataAvailability.getLastTimestamp(extraUser.address),
      ).to.equal(timestamp)
    })
  })

  describe('Timestamp Management', () => {
    it('should maintain timestamps in ascending order', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp1 = Math.floor(Date.now() / 1000)
      const timestamp2 = timestamp1 + 100
      const users = [extraUser.address]
      const values = [100]

      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp1, users, values)
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp2, users, values)

      const allTimestamps = await dataAvailability.getAllTimestamps()
      expect(allTimestamps[0]).to.equal(timestamp1)
      expect(allTimestamps[1]).to.equal(timestamp2)
    })
  })

  describe('Data Verification', () => {
    it('should verify data with valid proof', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      // Upload data first
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)

      // Create valid journal data with correct Commitment structure
      const journalData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(uint256,uint256)'],
        [[timestamp, await dataAvailability.getHash(timestamp)]],
      )

      // Create valid seal (in a real scenario this would be generated by the zkVM)
      const seal = hre.ethers.randomBytes(32)

      // Verify the data
      await expect(dataAvailability.verify(journalData, seal)).to.not.be
        .reverted

      // Check that the timestamp is now verified
      expect(await dataAvailability.isDataVerified(timestamp)).to.be.true
    })

    it('should not verify data for non-existent timestamp', async () => {
      const { dataAvailability } = await deployDataAvailabilityContract()

      const timestamp = Math.floor(Date.now() / 1000)
      const journalData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(uint256,uint256)'],
        [[timestamp, hre.ethers.ZeroHash]],
      )
      const seal = hre.ethers.randomBytes(32)

      await expect(dataAvailability.verify(journalData, seal))
        .to.be.revertedWithCustomError(dataAvailability, 'NoDataForTimestamp')
        .withArgs(timestamp)
    })

    it('should not verify data with incorrect hash', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      // Upload data first
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)

      // Create journal data with incorrect hash
      const journalData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(uint256,uint256)'],
        [[timestamp, hre.ethers.ZeroHash]],
      )
      const seal = hre.ethers.randomBytes(32)

      await expect(dataAvailability.verify(journalData, seal))
        .to.be.revertedWithCustomError(dataAvailability, 'HashMismatch')
        .withArgs(
          hre.ethers.ZeroHash,
          await dataAvailability.getHash(timestamp),
        )
    })

    it('should not verify already verified data', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      // Upload data first
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)

      // Create valid journal data
      const journalData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(uint256,uint256)'],
        [[timestamp, await dataAvailability.getHash(timestamp)]],
      )
      const seal = hre.ethers.randomBytes(32)

      // First verification should succeed
      await dataAvailability.verify(journalData, seal)

      // Second verification should fail
      await expect(dataAvailability.verify(journalData, seal))
        .to.be.revertedWithCustomError(dataAvailability, 'DataAlreadyVerified')
        .withArgs(timestamp)
    })

    it('should not allow uploading data for verified timestamp', async () => {
      const { dataAvailability, uploader, extraUser } =
        await deployDataAvailabilityContract()
      await dataAvailability.grantUploaderRole(uploader.address)

      const timestamp = Math.floor(Date.now() / 1000)
      const users = [extraUser.address]
      const values = [100]

      // Upload and verify data first
      await (
        dataAvailability.connect(uploader) as typeof dataAvailability
      ).uploadData(timestamp, users, values)

      const journalData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(uint256,uint256)'],
        [[timestamp, await dataAvailability.getHash(timestamp)]],
      )
      const seal = hre.ethers.randomBytes(32)
      await dataAvailability.verify(journalData, seal)

      // Attempt to upload new data for the same timestamp
      const newUsers = [uploader.address]
      const newValues = [200]

      await expect(
        (
          dataAvailability.connect(uploader) as typeof dataAvailability
        ).uploadData(timestamp, newUsers, newValues),
      )
        .to.be.revertedWithCustomError(
          dataAvailability,
          'CannotUploadAfterVerification',
        )
        .withArgs(timestamp)
    })
  })
})
