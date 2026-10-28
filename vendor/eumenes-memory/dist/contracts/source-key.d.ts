/**
 * 出典キー = (namespace, kind, id, representation)。内部 Map のキーとして使う。
 * contracts と view の両方から使うため contracts に置き、view/source-ref.ts から
 * 再 export する。
 */
export declare function sourceKey(ref: {
    readonly namespace: string;
    readonly kind: string;
    readonly id: string;
    readonly representation?: string;
}): string;
