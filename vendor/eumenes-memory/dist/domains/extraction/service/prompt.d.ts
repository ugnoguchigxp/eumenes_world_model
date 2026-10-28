/**
 * モデル向けの素材（固定文言 + 出力 JSON schema）。純粋で、モデルを呼ばない。モデル固有の request 形式への
 * 変換はホスト。文言と schema を変えたら `promptVersion` を上げる（ホストが `profile.promptVersion` に渡す）。
 *
 * schema は `candidate.ts` の厳密 parse と同じ形（未知のキーは run 全体が `OUTPUT_SCHEMA` で却下される）。
 * `scope` / `confidence` / `status` / `origin` はモデルに出させない（権限系の決定は Memory が行う）。
 */
import type { JsonValue } from "../../../contracts/common.ts";
import type { ExtractionPromptMaterial } from "../contracts/index.ts";
/** モデルに出させる JSON の schema。 */
export declare const EXTRACTION_OUTPUT_SCHEMA: JsonValue;
/** 固定文言（日本語）。変更したら promptVersion を上げる。 */
export declare const EXTRACTION_INSTRUCTIONS: string;
export declare function buildExtractionPromptMaterial(promptVersion: string): ExtractionPromptMaterial;
