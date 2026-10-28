import type { ExtractionOutput, ExtractionRejectedOutputReasonCode } from "../contracts/index.ts";
export type ParsedExtractionOutput = {
    readonly ok: true;
    readonly output: ExtractionOutput;
    /** canonical JSON の SHA-256 hex。 */
    readonly digest: string;
} | {
    readonly ok: false;
    readonly reasonCode: ExtractionRejectedOutputReasonCode;
    /** canonical 化できた場合だけ。できなければ null。 */
    readonly digest: string | null;
};
/** canonical JSON から digest（と byte 長）を求める。canonical 化できない値は null。 */
export declare function digestOutput(output: unknown): {
    readonly digest: string;
    readonly bytes: number;
} | null;
export declare function parseExtractionOutput(output: unknown): ParsedExtractionOutput;
