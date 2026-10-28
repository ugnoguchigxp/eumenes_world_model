/** 再帰的に Object.freeze する。plain object と配列だけが対象（parse 済みの値）。 */
export function deepFreeze(value) {
    if (typeof value !== "object" || value === null)
        return value;
    if (Object.isFrozen(value))
        return value;
    for (const key of Reflect.ownKeys(value)) {
        deepFreeze(value[key]);
    }
    return Object.freeze(value);
}
