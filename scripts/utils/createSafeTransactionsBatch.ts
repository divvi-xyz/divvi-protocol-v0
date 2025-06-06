import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export const createAddRewardSafeTransactionJSON = ({
  filePath,
  rewardPoolAddress,
  rewards,
  startTimestamp,
  endTimestampExclusive,
}: {
  filePath: string
  rewardPoolAddress: string
  rewards: {
    referrerId: string
    rewardAmount: string // in smallest unit of reward token
  }[]
  startTimestamp: Date
  endTimestampExclusive: Date
}) => {
  const users: string[] = []
  const amounts: string[] = []
  for (const reward of rewards) {
    if (BigInt(reward.rewardAmount) > 0n) {
      users.push(reward.referrerId)
      amounts.push(reward.rewardAmount)
    }
  }

  const transactionsBatch = {
    // The Safe UI will throw a warning about some missing properties, but will
    // fill in the correct values...

    // ..but the meta property required by the Safe UI, even if the value is an
    // empty object.
    meta: {},
    transactions: [
      {
        to: rewardPoolAddress,
        value: '0',
        data: null,
        contractMethod: {
          inputs: [
            { internalType: 'address[]', name: 'users', type: 'address[]' },
            {
              internalType: 'uint256[]',
              name: 'amounts',
              type: 'uint256[]',
            },
            {
              internalType: 'uint256[]',
              name: 'rewardFunctionArgs',
              type: 'uint256[]',
            },
          ],
          name: 'addRewards',
          payable: false,
        },
        contractInputsValues: {
          users: `[${users.join(', ')}]`,
          amounts: `[${amounts.join(', ')}]`,
          // Convert timestamps to seconds
          rewardFunctionArgs: `[${BigInt(startTimestamp.getTime() / 1000)}, ${BigInt(
            endTimestampExclusive.getTime() / 1000,
          )}]`,
        },
      },
    ],
  }

  // Create directory if it doesn't exist
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(transactionsBatch, null, 2) + '\n', {
    encoding: 'utf-8',
  })
}
