/** Ownership manifest. Add a dependency only with its first real import. */
export const domains = {
	identity: { depends: [] },
	assertions: { depends: ["identity", "conditions"] },
	conditions: { depends: [] },
	projection: { depends: ["identity", "conditions", "assertions"] },
	reasoning: { depends: ["conditions", "assertions", "projection"] },
	scenarios: {
		depends: ["conditions", "assertions", "projection", "reasoning"],
	},
	extraction: { depends: ["identity", "conditions", "assertions"] },
	lifecycle: { depends: [] },
} as const;
export type Domain = keyof typeof domains;
export type DomainGraph = Readonly<
	Record<string, { readonly depends: readonly string[] }>
>;
export function isDomain(value: string): value is Domain {
	return Object.hasOwn(domains, value);
}
export function closure(name: string, graph: DomainGraph = domains): string[] {
	const visited = new Set<string>();
	const visiting = new Set<string>();
	function visit(domain: string) {
		if (!Object.hasOwn(graph, domain))
			throw new Error(`unknown_domain:${domain}`);
		if (visiting.has(domain))
			throw new Error(`domain_dependency_cycle:${domain}`);
		if (visited.has(domain)) return;
		visiting.add(domain);
		for (const dep of graph[domain]!.depends) visit(dep);
		visiting.delete(domain);
		visited.add(domain);
	}
	visit(name);
	return [...visited];
}
export function ownedPath(domain: Domain): string {
	return `src/domains/${domain}`;
}
