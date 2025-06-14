import { task, types } from 'hardhat/config'
import { deployContract } from './helpers/deployHelpers'

task('reward-pool:deploy', 'Deploy RewardPool contract')
  .addParam('poolToken', 'Address of the token used for rewards')
  .addOptionalParam('rewardFunction', 'Identifier of the reward function')
  .addOptionalParam('ownerAddress', 'Address to use as owner')
  .addOptionalParam('managerAddress', 'Address that will have MANAGER_ROLE')
  .addOptionalParam(
    'timelock',
    'Timestamp when manager withdrawals will be allowed',
    0,
    types.int,
  )
  .addFlag('useDefender', 'Deploy using OpenZeppelin Defender')
  .addOptionalParam('defenderDeploySalt', 'Salt to use for CREATE2 deployments')
  .setAction(async (taskArgs, hre) => {
    const ownerAddress =
      taskArgs.ownerAddress || (await hre.ethers.getSigners())[0].address

    const managerAddress = taskArgs.managerAddress || ownerAddress

    const rewardFunctionId = hre.ethers.zeroPadValue(
      taskArgs.rewardFunction || '0x00',
      32,
    )

    await deployContract(
      hre,
      'RewardPool',
      [
        taskArgs.poolToken,
        rewardFunctionId,
        ownerAddress,
        managerAddress,
        taskArgs.timelock,
      ],
      {
        isUpgradeable: false,
        useDefender: taskArgs.useDefender,
        defenderDeploySalt: taskArgs.defenderDeploySalt,
      },
    )
  })
