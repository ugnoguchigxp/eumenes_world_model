/** build 2a–2d と validate V3 の共通判定。通れば null。 */
export function checkAccess(access, snapshot) {
    if (access.principal !== snapshot.principal)
        return "PRINCIPAL_MISMATCH";
    if (!access.scopeKeys.includes(snapshot.scopeKey)) {
        return "SCOPE_NOT_PERMITTED";
    }
    if (access.policyRevision !== snapshot.policyRevision) {
        return "POLICY_REVISION_MISMATCH";
    }
    if (!snapshot.complete)
        return "SNAPSHOT_INCOMPLETE";
    return null;
}
