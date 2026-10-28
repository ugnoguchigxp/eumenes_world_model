/**
 * SourceKey が Records の record のものなら recordId、そうでなければ null。
 * 形の一致だけでなく `recordSourceKey` で組み直して一致を確かめる。
 */
export declare function recordIdOfSourceKey(key: string): string | null;
