/** Hand-selected smoke cases, NOT gold labels or a representative quality sample. */
export const cases = [
	{
		recordId: "b10-ai-003",
		entityId: "tls-attacks",
		name: "TLSにおけるAES-CBCとRC4への攻撃",
		observationKeys: [],
	},
	{
		recordId: "b10-r-039",
		entityId: "model-fit",
		name: "統計モデルのR²と当てはまり",
		observationKeys: [],
	},
	{
		recordId: "b10-m-057",
		entityId: "free-medicine-trial",
		name: "必須医薬品無料配布RCT",
		observationKeys: [],
	},
	{
		recordId: "b10-l-075",
		entityId: "basic-pension",
		name: "日本の老齢基礎年金の受給要件",
		observationKeys: [
			{
				key: "eligibility_years",
				meaning: "受給資格期間の合計年数",
				unit: "year",
			},
			{ key: "age_years", meaning: "対象者の年齢", unit: "year" },
		],
	},
	{
		recordId: "b10-f-095",
		entityId: "tig-pwht",
		name: "MS/SS溶加材を用いたTIG溶接継手のPWHT研究",
		observationKeys: [],
	},
] as const;
