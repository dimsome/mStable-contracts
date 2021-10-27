import { ethers, network, tracer } from "hardhat"
import { expect, use } from "chai"
import { Signer, constants } from "ethers"
import { BN, simpleToExactAmount } from "@utils/math"
import { deployContract } from "tasks/utils/deploy-utils"
import { deployFeederPool, deployVault, FeederData, VaultData } from "tasks/utils/feederUtils"
import { increaseTime } from "@utils/time"
import { MAX_UINT256, ONE_DAY, ONE_WEEK, ZERO_ADDRESS, ONE_MIN } from "@utils/constants"
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
        const data =
            "0xc98075390000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000006800101000101010001000101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000046000000000000000000000003fb821a27fcd8c306252e6f92e7a7fcb00012e9403191c120a0b010e020c0507091e0313140816150f1a0d0611001d101b041718000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001f0000000000000000000000000000000000000000000000000000005fcc09bd740000000000000000000000000000000000000000000000000000005fcc09bd740000000000000000000000000000000000000000000000000000005fcc6b8ed50000000000000000000000000000000000000000000000000000005fcc6b8ed50000000000000000000000000000000000000000000000000000005fccd4b6320000000000000000000000000000000000000000000000000000005fcd1e406d0000000000000000000000000000000000000000000000000000005fd1d3a6900000000000000000000000000000000000000000000000000000005fdb671ad20000000000000000000000000000000000000000000000000000005fdb671ad20000000000000000000000000000000000000000000000000000005fdbc87ba70000000000000000000000000000000000000000000000000000005fddbe2cb30000000000000000000000000000000000000000000000000000005fdeed80800000000000000000000000000000000000000000000000000000005fe0c686400000000000000000000000000000000000000000000000000000005fe14098400000000000000000000000000000000000000000000000000000005fe64bb1b40000000000000000000000000000000000000000000000000000005fe782c4800000000000000000000000000000000000000000000000000000005fe782c4800000000000000000000000000000000000000000000000000000005febb2eeca0000000000000000000000000000000000000000000000000000005ff3a724230000000000000000000000000000000000000000000000000000005ff3a724230000000000000000000000000000000000000000000000000000005ff3df50790000000000000000000000000000000000000000000000000000005ff3df50790000000000000000000000000000000000000000000000000000005ff596f94d0000000000000000000000000000000000000000000000000000005ff596f94d000000000000000000000000000000000000000000000000000000601768c546000000000000000000000000000000000000000000000000000000601a1f0ba60000000000000000000000000000000000000000000000000000006023ed38740000000000000000000000000000000000000000000000000000006023ed38740000000000000000000000000000000000000000000000000000006023ed38740000000000000000000000000000000000000000000000000000006023ed38740000000000000000000000000000000000000000000000000000006023ed3874000000000000000000000000000000000000000000000000000000000000000bae083ce20ae8c53b61a6b422f84806ef4980b95d15e0c4c13a5fa6326be152636dc80d088246058bc1de6e696a77b6739b068d62ab0334f0e70c5ba7bd5b39bc64c96c88a091a856b8185954907cb3413b4249445eebca9719006f6ecb249128a6845b493bf55e8f564dc823e60ddc7a9eb0f28aebd28b06d182d2e2b1e9f124b72763814c2191345042cfb4202709db731ae2b6aa0d09b9d03be8f8e646b43118770349e092f80f468c3190c3f59f406a96d177d9b01587a37acf6baf151bd88c9426e3f54d5a1defb19fb0847d0373d22e329bf3e850b7e36af2ad829d81e8861b3420494f061b55b274db2a1c1fca0e004875de1d23d84b1184df2d5f24870a90d922981ee2edd02c8eeee7f3c86bf1f9056001f23b5f23891204bbb62b4435525e74031e3b4100bc0ed3976d17e916bf3507830c553e9c0fbdb9e9fbe06fc7167776e120a24496673a33cb933610ce97ec4329e408bcca2c95acd3e84ab4000000000000000000000000000000000000000000000000000000000000000b4672f6deeb591dc17e0576e213a29a20a5c4f26aad70093c961f06c6032839536770d5fc8f918ecb9a51be594b0f420c6f2e7f0f7e7cad5d58406ec5d445220875d75000aee9a9e0b0291a2d22e3657cdcf2bb1868b32ceaac2eb717002938ad169f96a085f70047a8213f57939b04d443612baa99cb8a91b470391af4899655434b8bd85e68b8c91609e4b8d4388df1c9cbf54f6ab47dd61b1d4285fa4cbdd27b35f1c0f23f36468aae8dfb3790cabe1e0deb343bb280c4ba41c6c36131e9ec16ec479cb2ba683942c3ee8e4f508c595177116b8839ff7fcfb68ea7bea13eb16d84846724d97460ab593382f02f473907f4108e47e62d3f2c117ab87ca04f3f62e8fe3f8340b870b7a99c08ead4fcd106e2c59fa85756e2023070ee1c6205cd7a8da4f0dc8a60fdfc49c66a73a9a36d2ff958007168740cad88a00c236c0d602683830be028dbf0e3f8c4260a6baf5badea340e0ee1828c3c983387bed0959e"

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
        ethWhale = await impersonate(ethWhaleAddress)

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
            // await setup(13341174)
            await setup(13478400)
            await reportSig()
            await increaseTime(50)
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
                await increaseTime(ONE_MIN)
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
                await increaseTime(50)
                const withdrawAmount = simpleToExactAmount(1000)
                expect(await lusdToken.balanceOf(bProtocolIntegration.address), "Cache in Integration before").to.eq(0)

                await lusdFp.connect(lUsdWhale).redeemExactBassets([LUSD.address], [withdrawAmount], firstMintAmount, lUsdWhaleAddress)
            })
        })
    })
})
