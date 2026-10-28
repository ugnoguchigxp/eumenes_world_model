import type { CurrentBasis, RevalidationResult, UsageBasis } from "../contracts/index.ts";
/**
 * 回答採用時に、利用した根拠と必須集合を再検証する。
 * - 無関係な更新（利用していないitem・scopeの変更）は失効させない。
 * - 利用したitemの版変更・消失、scope認可の変更、方針の版、必須集合のdigest、関連する訂正の未処理は失効。
 * - 訂正の影響scopeが不明（`"*"`）なら保守的に失効。
 */
export declare function revalidateUsage(basis: UsageBasis, current: CurrentBasis): RevalidationResult;
