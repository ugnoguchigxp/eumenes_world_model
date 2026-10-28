/** 再帰的に Object.freeze する。plain object と配列だけが対象（parse 済みの値）。 */
export declare function deepFreeze<T>(value: T): T;
