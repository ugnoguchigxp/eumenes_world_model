/** Single definition site for every size limit (contract C2). Bytes are UTF-8. */
export const limits = Object.freeze({
	idBytes: 256,
	versionBytes: 256,
	predicateBytes: 256,
	operationKeyBytes: 256,
	stringValueBytes: 4096,
	payloadBytes: 64 * 1024,
	manifestDependencies: 32,
	canonicalDepth: 64,
});
