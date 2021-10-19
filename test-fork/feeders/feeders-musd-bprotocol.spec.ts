import { ethers, network, tracer } from "hardhat"
import { expect, use } from "chai"
import { Signer, constants } from "ethers"
import { BN, simpleToExactAmount } from "@utils/math"
import { deployContract } from "tasks/utils/deploy-utils"
import { deployFeederPool, deployVault, FeederData, VaultData } from "tasks/utils/feederUtils"
import { increaseTime } from "@utils/time"
import { MAX_UINT256, ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { Chain, mUSD, LUSD, MTA } from "tasks/utils/tokens"
import { getChainAddress } from "tasks/utils/networkAddressFactory"
import {
    IERC20,
    IERC20__factory,
    FeederPool,
    FeederPool__factory,
    AssetProxy__factory,
    AssetProxy,
    BoostedVault,
    BoostedVault__factory,
    RewardsDistributorEth,
    RewardsDistributorEth__factory,
    BProtocolIntegration,
    BProtocolIntegration__factory,
    IBProtocolStabilityPool,
    IBProtocolStabilityPool__factory,
    ILiquityStabilityPool,
    ILiquityStabilityPool__factory,
} from "types/generated"

import { impersonate } from "@utils/fork"
import { solidity } from "ethereum-waffle"
import { first } from "lodash"

use(solidity)

const chain = Chain.mainnet

const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84"
const governorAddress = getChainAddress("Governor", chain)
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mUsdWhaleAddress = "0x69E0E2b3d523D3b247d798a49C3fa022a46DD6bd"
const lUsdWhaleAddress = "0x31f8cc382c9898b273eff4e0b7626a6987c846e8"

const bProtocolStabilityPoolAddress = "0x0d3AbAA7E088C2c82f54B2f47613DA438ea8C598"
const liquityStabilityPoolAddress = "0x66017D22b0f8556afDd19FC67041899Eb65a21bb"

const fundManagerAddress = "0xB81473F20818225302b8FfFB905B53D58a793D84"
const rewardsDistributorAddress = getChainAddress("RewardsDistributor", chain)

const toEther = (amount: BN) => ethers.utils.formatEther(amount)

context("LUSD Feeder Pool integration to BProtocol", () => {
    // Admins
    let deployer: Signer
    let governor: Signer
    // Whales
    let ethWhale: Signer
    let mUsdWhale: Signer
    let lUsdWhale: Signer
    let fundManager: Signer
    // Tokens
    let mtaToken: IERC20
    let musdToken: IERC20
    let lusdToken: IERC20
    // Contracts
    let lusdFp: FeederPool
    let vault: BoostedVault
    let vaultProxy: AssetProxy
    let rewardsDistributor: RewardsDistributorEth
    let bProtocolIntegration: BProtocolIntegration
    let bProtocolStabilityPool: IBProtocolStabilityPool
    let liquityStability: ILiquityStabilityPool

    const firstMintAmount = simpleToExactAmount(10000)
    const secondMintAmount = simpleToExactAmount(2000)
    const approveAmount = firstMintAmount.add(secondMintAmount)

    // ChainLink Fork Workaround
    const reportSig = async () => {
        const transAddress = "0x982fa4d5f5c8c0063493abe58967ca3b7639f10f"
        const trans = await impersonate(transAddress)

        // "TODO - take latest data from 0x37bC7498f4FF12C19678ee8fE19d713b87F6a9e6"
        const data = `0xc98075390000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000006800101000100000100000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000046000000000000000000000003fb821a27fcd8c306252e6f92e7a7fcb00011c7406111b1219010e1a0d0602180516100a1c0b07090c0313151e0f17081404001d000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001f00000000000000000000000000000000000000000000000000000058283c0fd100000000000000000000000000000000000000000000000000000058283c0fd100000000000000000000000000000000000000000000000000000058384237400000000000000000000000000000000000000000000000000000005838423740000000000000000000000000000000000000000000000000000000583842374000000000000000000000000000000000000000000000000000000058384237400000000000000000000000000000000000000000000000000000005838b7684600000000000000000000000000000000000000000000000000000058392c994c00000000000000000000000000000000000000000000000000000058392c994c00000000000000000000000000000000000000000000000000000058392c994c00000000000000000000000000000000000000000000000000000058392c994c00000000000000000000000000000000000000000000000000000058392c994c00000000000000000000000000000000000000000000000000000058392c994c0000000000000000000000000000000000000000000000000000005839901b6d0000000000000000000000000000000000000000000000000000005839ad6411000000000000000000000000000000000000000000000000000000583a742350000000000000000000000000000000000000000000000000000000583a8dc9e0000000000000000000000000000000000000000000000000000000583aebeaab000000000000000000000000000000000000000000000000000000583b3fcd05000000000000000000000000000000000000000000000000000000583cdb39b0000000000000000000000000000000000000000000000000000000583f3e2dcb0000000000000000000000000000000000000000000000000000005844159ae70000000000000000000000000000000000000000000000000000005844159ae70000000000000000000000000000000000000000000000000000005844159ae70000000000000000000000000000000000000000000000000000005844159ae700000000000000000000000000000000000000000000000000000058451313000000000000000000000000000000000000000000000000000000005845a8a4640000000000000000000000000000000000000000000000000000005846073700000000000000000000000000000000000000000000000000000000584d1937e70000000000000000000000000000000000000000000000000000005851fd3e4600000000000000000000000000000000000000000000000000000058570c4d8c000000000000000000000000000000000000000000000000000000000000000bb6dc076288282efad72e6271abee6788ac1eb4adab2b691ca2684ef3e0331ea0064ad3b0d08236f0710d77be4e4aae4eec292603db50e8c0258d7563b3aea676b211e8f6c7f6cdd0adbdad2c762d379bd3d89a9cfb133196c974aed7a8fbbf8e54b583bafee332384facb91311d7d64a4ff70bb38194297d84efe550ebd11eedce0ab7f10f23ab6c62ee4e9ba0c066911c6b73911d0c3fd1c95b5e74d5fb365a67bb4fb5b84a71553dd229c94616fe5ac6ec1531ca65dbb3cf0b65652e5201cf77519cee6ed6d75ceb15d4dfd62066b4ce98564eaaa0370a927ab84dad965ae3030bb8018be840724009313ea5ad74662f4ea335bb714f0750671a241144e44b2af5f50d124828bb8957a5b38ea0dadf3fdac0978893b4bedbdd515592b28d2f48feed5021df65be500f44d4ffb56bd2ca65c141ff134b454d7d1dd72c8b4418363d941921f384db4efdd1c8e72bbb05b39672c72fea1bc769d5bb02e7b48eba000000000000000000000000000000000000000000000000000000000000000b0d88fa76e44e5b8617bf4d091cb546db31ffc4f38fd4e8d2913624299f726334357b2522c15801a8251f2cde887163dfac679de129d0ff39444635af33c606d92168e19f2e30cb0ab9092eb43f45ca61b4ae295f07f880128c318af380f588420daea3987dc1f669075db165aff32dacf5442d630fe50e97ae73d7dd98c6e8652163d9eedc444bc725420f0da3d21d1626c3bd28cb509d6786ae3271be1da16740ad38a9fe6df7bb0559c82ef4e8a4e25637cb54edcb9f8a0aa14ef62a0d6a3775053d3fdf638f82b68d0b1eef50b238c402a9050cea5251fea39174ca26a6903b8659f93e8ce6292acc52070bf9f1a73170417ef433387759bdaa49ebd52d2a53a56cd9658931fcca1cabdcde3ff524767f7983df4694aabd750e19ad92f4a942721f201c66d8327aade0a9c363be391db4db2263f9d496b1c9287f6b0144562d8ae038c1d8e86dd8e9b6e74afe7245ffd86952c0e56971b94b6847825c5b77`

        await trans.sendTransaction({ to: "0x37bC7498f4FF12C19678ee8fE19d713b87F6a9e6", data })
    }

    const setup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        })

        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        mUsdWhale = await impersonate(mUsdWhaleAddress)
        lUsdWhale = await impersonate(lUsdWhaleAddress)
        fundManager = await impersonate(fundManagerAddress)

        musdToken = IERC20__factory.connect(mUSD.address, deployer)
        tracer.nameTags[mUSD.address] = "mUSD Token"
        lusdToken = IERC20__factory.connect(LUSD.address, deployer)
        mtaToken = IERC20__factory.connect(MTA.address, deployer)
        tracer.nameTags[LUSD.address] = "LUSD Token"
        tracer.nameTags["0x6DEA81C8171D0bA574754EF6F8b412F2Ed88c54D"] = "LQTY Token"
        tracer.nameTags["0xD8c9D9071123a059C6E0A945cF0e0c82b508d816"] = "LQTY Issuer"

        bProtocolStabilityPool = IBProtocolStabilityPool__factory.connect(bProtocolStabilityPoolAddress, deployer)
        tracer.nameTags[bProtocolStabilityPoolAddress] = "bProtocol BAMM"
        rewardsDistributor = RewardsDistributorEth__factory.connect(rewardsDistributorAddress, fundManager)

        // https://github.com/liquity/dev#stability-pool-functions---stabilitypoolsol
        liquityStability = ILiquityStabilityPool__factory.connect(liquityStabilityPoolAddress, deployer)
        tracer.nameTags[liquityStabilityPoolAddress] = "liquity StabilityPool"
    }
    context("Feeder Deploy without integration or vault", () => {
        before("reset block number", async () => {
            await setup(13341174)
        })
        it("Test connectivity", async () => {
            const currentBlock = await ethers.provider.getBlockNumber()
            console.log(`Current block ${currentBlock}`)
            const startEther = await deployer.getBalance()
            console.log(`Deployer ${deployerAddress} has ${startEther} Ether`)
        })
        it("Deploy LUSD Feeder Pool", async () => {
            const config = {
                a: BN.from(50),
                limits: {
                    min: simpleToExactAmount(10, 16),
                    max: simpleToExactAmount(90, 16),
                },
            }
            const fpData: FeederData = {
                mAsset: mUSD,
                fAsset: LUSD,
                name: "mUSD/LUSD Feeder Pool",
                symbol: "fPmUSD/LUSD",
                config,
            }

            lusdFp = await deployFeederPool(deployer, fpData, chain)

            expect(await lusdFp.name(), "name").to.eq(fpData.name)
            expect(await lusdFp.symbol(), "symbol").to.eq(fpData.symbol)

            tracer.nameTags[lusdFp.address] = "LUSD Feeder Pool"
        })
        it("Mint first mUSD/LUSD fpTokens", async () => {
            const lusdBassetBefore = await lusdFp.getBasset(lusdToken.address)
            const mUsdBassetBefore = await lusdFp.getBasset(musdToken.address)

            // Balances should be 0
            expect(await lusdToken.balanceOf(lusdFp.address), "alUSD bal before").to.eq(0)
            expect(await musdToken.balanceOf(lusdFp.address), "mUSD bal before").to.eq(0)
            expect(await lusdFp.balanceOf(lUsdWhaleAddress), "whale fp bal before").to.eq(0)

            // Transfer some mUSD to the LUSD whale so they can do a mintMulti (to get the pool started)
            await musdToken.connect(mUsdWhale).transfer(lUsdWhaleAddress, approveAmount)
            expect(await musdToken.balanceOf(lUsdWhaleAddress), "lUsdWhale's mUSD bal after").to.gte(approveAmount)

            // Approve tokens to spend
            await lusdToken.connect(lUsdWhale).approve(lusdFp.address, constants.MaxUint256)
            await musdToken.connect(lUsdWhale).approve(lusdFp.address, constants.MaxUint256)
            expect(await lusdToken.allowance(lUsdWhaleAddress, lusdFp.address), "lUsdWhale's LUSD approved amount").to.eq(
                constants.MaxUint256,
            )
            expect(await musdToken.allowance(lUsdWhaleAddress, lusdFp.address), "lUsdWhale's mUSD approved amount").to.eq(
                constants.MaxUint256,
            )

            expect(await lusdToken.balanceOf(lUsdWhaleAddress), "lUsd whale lUSD bal before").gte(approveAmount)
            expect(await musdToken.balanceOf(lUsdWhaleAddress), "lUsd whale mUSD bal before").gte(approveAmount)

            await lusdFp
                .connect(lUsdWhale)
                .mintMulti(
                    [lusdToken.address, musdToken.address],
                    [firstMintAmount, firstMintAmount],
                    firstMintAmount.mul(2).sub(1),
                    lUsdWhaleAddress,
                )

            const lusdBassetAfter = await lusdFp.getBasset(lusdToken.address)
            const mUsdBassetAfter = await lusdFp.getBasset(musdToken.address)
            expect(lusdBassetAfter.vaultData.vaultBalance, "LUSD vault balance").to.eq(
                lusdBassetBefore.vaultData.vaultBalance.add(firstMintAmount),
            )
            expect(mUsdBassetAfter.vaultData.vaultBalance, "mUSD vault balance").to.eq(
                mUsdBassetBefore.vaultData.vaultBalance.add(firstMintAmount),
            )
            expect(await lusdFp.balanceOf(lUsdWhaleAddress), "whale fp bal after").to.eq(firstMintAmount.mul(2).add(1))
        })
        describe("Deploy BoostedVault for Feeder Pool", async () => {
            it("Deploy boosted staking vault", async () => {
                const vaultData = {
                    boosted: true,
                    name: "v-mUSD/LUSD fPool Vault",
                    symbol: "v-fPmUSD/LUSD",
                    priceCoeff: simpleToExactAmount(1),
                    stakingToken: lusdFp.address,
                    rewardToken: MTA.address,
                    boostCoeff: 48,
                }
                const constructorArguments = [
                    getChainAddress("Nexus", chain),
                    vaultData.stakingToken,
                    getChainAddress("BoostDirector", chain),
                    vaultData.priceCoeff,
                    vaultData.boostCoeff,
                    vaultData.rewardToken,
                ]
                vault = await deployContract(new BoostedVault__factory(deployer), "BoostedVault", constructorArguments)
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                expect(vault.address).to.be.properAddress
                tracer.nameTags[vault.address] = "LUSD Vault"

                vault.initialize(rewardsDistributorAddress, vaultData.name, vaultData.symbol)
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                expect(vault.address).to.be.properAddress

                expect(await vault.nexus(), "Nexus address").to.eq(getChainAddress("Nexus", chain))
                expect(await vault.stakingToken(), "Staking Token").to.eq(vaultData.stakingToken)
                expect(await vault.boostDirector(), "Boost Director").to.eq(getChainAddress("BoostDirector", chain))
                expect(await vault.rewardsToken(), "Rewards Token").to.eq(vaultData.rewardToken)
                expect(await vault.rewardsDistributor(), "rewardsDistributor").to.eq(getChainAddress("RewardsDistributor", chain))

                expect(await vault.totalSupply(), "totalSupply").to.eq(BN.from(0))
                expect(await vault.periodFinish(), "periodFinish").to.eq(BN.from(0))
                expect(await vault.rewardRate(), "rewardRate").to.eq(BN.from(0))
                expect(await vault.lastUpdateTime(), "lastUpdateTime").to.eq(BN.from(0))
                expect(await vault.rewardPerTokenStored(), "rewardPerTokenStored").to.eq(BN.from(0))
                expect(await vault.lastTimeRewardApplicable(), "lastTimeRewardApplicable").to.eq(BN.from(0))
                expect(await vault.rewardPerToken(), "rewardPerToken").to.eq(BN.from(0))
            })
            it("Fund the vault with MTA", async () => {
                const distributionAmount = simpleToExactAmount(10000)
                const fundManagerMtaBalBefore = await mtaToken.balanceOf(fundManagerAddress)
                expect(fundManagerMtaBalBefore, "fund manager mta bal before").to.gt(distributionAmount)

                await mtaToken.connect(fundManager).approve(rewardsDistributor.address, distributionAmount)
                await rewardsDistributor.connect(fundManager).distributeRewards([vault.address], [distributionAmount])

                expect(await mtaToken.balanceOf(fundManagerAddress), "fund manager mta bal before").to.eq(
                    fundManagerMtaBalBefore.sub(distributionAmount),
                )

                expect(await vault.periodFinish(), "periodFinish").to.not.eq(BN.from(0))
                expect(await vault.rewardRate(), "rewardRate").to.not.eq(BN.from(0))
                expect(await vault.lastUpdateTime(), "lastUpdateTime").to.not.eq(BN.from(0))
                expect(await vault.lastTimeRewardApplicable(), "lastTimeRewardApplicable").to.not.eq(BN.from(0))
            })
            it("Stake fPmUSD/LUSD in vault", async () => {
                const fpmUSDTokenAmount = await lusdFp.balanceOf(lUsdWhaleAddress)
                expect(await vault.balanceOf(lUsdWhaleAddress), "Whale Vault balance before").to.eq(0)
                expect(fpmUSDTokenAmount).to.gt(0)

                await lusdFp.connect(lUsdWhale).approve(vault.address, fpmUSDTokenAmount)
                await vault.connect(lUsdWhale)["stake(uint256)"](fpmUSDTokenAmount)

                expect(await vault.balanceOf(lUsdWhaleAddress), "Whale Vault balance after").to.eq(fpmUSDTokenAmount)
                expect(await lusdFp.balanceOf(lUsdWhaleAddress), "Feeder Pool tokens after").to.eq(0)
            })
            it("Claim MTA from vault", async () => {
                await increaseTime(ONE_DAY)
                expect(await mtaToken.balanceOf(lUsdWhaleAddress), "Whale MTA balance before").to.eq(0)

                await vault.connect(lUsdWhale).claimReward()

                expect(await mtaToken.balanceOf(lUsdWhaleAddress), "Whale MTA balance after").to.gt(0)
            })
        })
        describe("LUSD BProtocol integration", async () => {
            it("Deploy integration contract", async () => {
                bProtocolIntegration = await deployContract<BProtocolIntegration>(
                    new BProtocolIntegration__factory(deployer),
                    "BProtocol LUSD integration",
                    [getChainAddress("Nexus", chain), lusdFp.address, bProtocolStabilityPoolAddress, LUSD.address],
                )

                tracer.nameTags[bProtocolIntegration.address] = "bProtocolIntegration"

                expect(await bProtocolIntegration.nexus(), "Nexus").to.eq(getChainAddress("Nexus", chain))
                expect(await bProtocolIntegration.lpAddress(), "Feeder Pool address").to.eq(lusdFp.address)
                // TODO: Reward token?
                // expect(await bProtocolIntegration.rewardToken(), "rewards token").to.eq(ALCX.address)
                expect(await bProtocolIntegration.stabilityPool(), "BProtocol Stability Pool").to.eq(bProtocolStabilityPoolAddress)
                expect(await bProtocolIntegration.bAsset(), "bAsset").to.eq(LUSD.address)
            })
            it("Initializing BProtocol integration", async () => {
                expect(
                    await lusdToken.allowance(bProtocolIntegration.address, bProtocolStabilityPoolAddress),
                    "integration LUSD allowance before",
                ).to.eq(0)

                await bProtocolIntegration.initialize()

                expect(
                    await lusdToken.allowance(bProtocolIntegration.address, bProtocolStabilityPoolAddress),
                    "Integration LUSD allowance after",
                ).to.eq(MAX_UINT256)

                // TODO: Initializing more tokens if necessary
            })
            it("Migrate LUSD Feeder Pool to BProtocol Integration", async () => {
                // Init ChainLink
                reportSig()

                expect(await lusdToken.balanceOf(lusdFp.address), "LUSD bal before").to.eq(firstMintAmount)
                expect(await lusdToken.balanceOf(bProtocolIntegration.address), "LUSD integration bal before").to.eq(0)
                expect(await musdToken.balanceOf(lusdFp.address), "mUSD bal before").to.eq(firstMintAmount)

                await lusdFp.connect(governor).migrateBassets([lusdToken.address], bProtocolIntegration.address)

                expect(await lusdToken.balanceOf(lusdFp.address), "LUSD fp bal after").to.eq(0)
                expect(await lusdToken.balanceOf(bProtocolIntegration.address), "LUSD integration bal after").to.eq(firstMintAmount)
                expect(await musdToken.balanceOf(lusdFp.address), "mUSD bal after").to.eq(firstMintAmount)
                expect(await bProtocolStabilityPool.balanceOf(bProtocolIntegration.address), "integration's LUSD deposited after").to.eq(0)
            })
            it("Deposit more mUSD/LUSD in the Feeder Pool", async () => {
                const lUsdBassetBefore = await lusdFp.getBasset(lusdToken.address)
                const mUsdBassetBefore = await lusdFp.getBasset(mUSD.address)

                expect(await bProtocolStabilityPool.balanceOf(bProtocolIntegration.address), "integration's LUSD shares before").to.eq(0)
                expect(lUsdBassetBefore.vaultData.vaultBalance, "LUSD vault balance before").to.eq(firstMintAmount)
                expect(mUsdBassetBefore.vaultData.vaultBalance, "mUSD vault balance before").to.eq(firstMintAmount)

                const lUsdBalanceStabilityPoolBefore = await liquityStability.getCompoundedLUSDDeposit(bProtocolStabilityPool.address)
                expect(lUsdBalanceStabilityPoolBefore, "Balance LUSD in stabilityPool before, should have some LUSD").to.gt(0)

                await lusdFp
                    .connect(lUsdWhale)
                    .mintMulti(
                        [lusdToken.address, musdToken.address],
                        [secondMintAmount, secondMintAmount],
                        secondMintAmount.mul(2).sub(1),
                        lUsdWhaleAddress,
                    )

                const lUsdBassetAfter = await lusdFp.getBasset(lusdToken.address)
                const mUsdBassetAfter = await lusdFp.getBasset(mUSD.address)

                expect(await lusdToken.balanceOf(lusdFp.address), "LUSD fp bal after").to.eq(0)
                expect(lUsdBassetAfter.vaultData.vaultBalance, "LUSD vault balance after").to.eq(approveAmount)
                expect(mUsdBassetAfter.vaultData.vaultBalance, "mUSD vault balance after").to.eq(approveAmount)

                const cacheAmount = simpleToExactAmount(1000)
                expect(await lusdToken.balanceOf(bProtocolIntegration.address), "LUSD integration bal after").to.eq(cacheAmount)

                expect(await bProtocolStabilityPool.balanceOf(bProtocolIntegration.address), "integration's LUSD shares after").to.gt(0)
                expect(await bProtocolIntegration.bAssetBalance(), "Total amount after deposit").to.eq(approveAmount.sub(cacheAmount))

                // Check if Stability pool got the LUSD
                const lUsdBalanceStabilityPoolAfter = await liquityStability.getCompoundedLUSDDeposit(bProtocolStabilityPool.address)
                expect(lUsdBalanceStabilityPoolAfter).to.eq(lUsdBalanceStabilityPoolBefore.add(approveAmount.sub(cacheAmount)))
            })
            it("Withdraw from BProtocol to deplete LUSD cache", async () => {
                // Clear cache amount first
                const cacheAmount = simpleToExactAmount(1000)
                expect(await lusdToken.balanceOf(bProtocolIntegration.address), "Cache in Integration before").to.eq(cacheAmount)
                const whaleLusdBefore = await lusdToken.balanceOf(lUsdWhaleAddress)
                const lUsdBassetBefore = await lusdFp.getBasset(lusdToken.address)

                // const fpPrice = await lusdFp.connect(lUsdWhale).getPrice()
                // const redeemAmount = cacheAmount.div(fpPrice.price)

                await lusdFp.connect(lUsdWhale).redeemExactBassets([LUSD.address], [cacheAmount], firstMintAmount, lUsdWhaleAddress)

                const lUsdBassetAfter = await lusdFp.getBasset(lusdToken.address)
                const whaleLusdAfter = await lusdToken.balanceOf(lUsdWhaleAddress)

                expect(whaleLusdAfter.sub(whaleLusdBefore), "Balance change for Whale").to.eq(cacheAmount)
                expect(lUsdBassetAfter.vaultData.vaultBalance, "LUSD after withdrawing").to.eq(
                    lUsdBassetBefore.vaultData.vaultBalance.sub(cacheAmount),
                )
                expect(await lusdToken.balanceOf(bProtocolIntegration.address), "Cache in Integration after").to.lt(cacheAmount)
                expect(await musdToken.balanceOf(lUsdWhaleAddress), "mUSD bal for Whale").to.eq(0)
            })
            it("Withdraw LUSD to redeem from Integration", async () => {
                // Cache should be empty
                const withdrawAmount = simpleToExactAmount(10)
                expect(await lusdToken.balanceOf(bProtocolIntegration.address), "Cache in Integration before").to.eq(0)

                await lusdFp.connect(lUsdWhale).redeemExactBassets([LUSD.address], [withdrawAmount], firstMintAmount, lUsdWhaleAddress)
            })
        })
    })
})
