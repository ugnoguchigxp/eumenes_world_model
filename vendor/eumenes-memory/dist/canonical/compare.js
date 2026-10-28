/** UTF-16 コード単位の昇順比較。locale に依存しない。 */
export function compareCodeUnits(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
