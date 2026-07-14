import { PF2E_DAMAGE_TYPES, DAMAGE_CATEGORIES, DIE_SIZES } from "../../constants.mjs"
import { capitalize, slugify, tKey } from "../../utils.mjs"

export const DEFAULT_DAMAGE_PART = {
   dice: 1,
   die: "d6",
   type: "bludgeoning",
   category: "normal",
}

export const DEFAULT_HEAL_PART = {
   dice: 1,
   die: "d6",
   bonus: 0,
}

const CONSEQUENCE_OUTCOMES = [
   { value: "no-roll", labelKey: "ActionTab.ConsequenceNoRoll" },
   { value: "criticalSuccess", labelKey: "ActionTab.CriticalSuccess" },
   { value: "success", labelKey: "ActionTab.Success" },
   { value: "failure", labelKey: "ActionTab.Failure" },
   { value: "criticalFailure", labelKey: "ActionTab.CriticalFailure" },
]

const CONSEQUENCE_TYPES = [
   { value: "apply-condition", labelKey: "ActionTab.ApplyCondition" },
   { value: "apply-effect", labelKey: "ActionTab.ApplyEffect" },
   { value: "apply-rule-element", labelKey: "ActionTab.ApplyRuleElement" },
   { value: "remove-condition", labelKey: "ActionTab.RemoveCondition" },
   { value: "remove-effect", labelKey: "ActionTab.RemoveEffect" },
   { value: "deal-damage", labelKey: "ActionTab.DealDamage" },
   { value: "heal", labelKey: "ActionTab.Heal" },
   { value: "saving-throw", labelKey: "ActionTab.SavingThrow" },
]

const CONSEQUENCE_TYPES_WITHOUT_SAVE = CONSEQUENCE_TYPES.filter(
   (type) => type.value !== "saving-throw",
)

const CONSEQUENCE_TARGETS = [
   { value: "crewman", labelKey: "ActionTab.TriggeringCrewmember" },
   { value: "all-crewmembers", labelKey: "ActionTab.AllCrewmembers" },
   { value: "vehicle", labelKey: "ActionTab.Vehicle" },
]

const CONSEQUENCE_DURATION_UNITS = ["rounds", "minutes", "hours", "days"]
const CONSEQUENCE_SAVES = ["fortitude", "reflex", "will"]

const VALUED_CONDITIONS = new Set([
   "clumsy",
   "doomed",
   "drained",
   "dying",
   "enfeebled",
   "frightened",
   "persistent-damage",
   "sickened",
   "slowed",
   "stunned",
   "stupefied",
   "wounded",
])

export function defaultConsequence(type = "apply-condition") {
   return {
      outcome: "no-roll",
      type,
      target: "crewman",
      condition: "frightened",
      value: 1,
      hasDuration: false,
      durationUnit: "rounds",
      durationValue: 1,
      effectUuid: "",
      ruleJson: '{\n  "key": "FlatModifier"\n}',
      damageParts: [{ ...DEFAULT_DAMAGE_PART }],
      healParts: [{ ...DEFAULT_HEAL_PART }],
      save: "reflex",
      dc: "",
      basicSave: false,
      basicDamageParts: [{ ...DEFAULT_DAMAGE_PART }],
      consequences: [],
   }
}

export function normalizeDamageParts(parts) {
   const source = Array.isArray(parts) && parts.length > 0
      ? parts
      : [{ ...DEFAULT_DAMAGE_PART }]
   return source.map((part) => ({
      dice: Math.max(0, parseInt(part?.dice) || 0),
      die: DIE_SIZES.includes(part?.die) ? part.die : "d6",
      type: PF2E_DAMAGE_TYPES.includes(part?.type)
         ? part.type
         : "bludgeoning",
      category: DAMAGE_CATEGORIES.includes(part?.category)
         ? part.category
         : "normal",
   }))
}

export function normalizeHealParts(parts) {
   const source = Array.isArray(parts) && parts.length > 0
      ? parts
      : [{ ...DEFAULT_HEAL_PART }]
   return source.map((part) => ({
      dice: Math.max(0, parseInt(part?.dice) || 0),
      die: DIE_SIZES.includes(part?.die) ? part.die : "d6",
      bonus: parseInt(part?.bonus) || 0,
   }))
}

export function normalizeConsequences(raw, { allowSavingThrow = true } = {}) {
   if (!Array.isArray(raw)) return []
   const outcomeValues = new Set(CONSEQUENCE_OUTCOMES.map((o) => o.value))
   const types = allowSavingThrow
      ? CONSEQUENCE_TYPES
      : CONSEQUENCE_TYPES_WITHOUT_SAVE
   const typeValues = new Set(types.map((o) => o.value))
   const targetValues = new Set(CONSEQUENCE_TARGETS.map((o) => o.value))
   return raw.map((entry) => {
      const type = typeValues.has(entry?.type)
         ? entry.type
         : "apply-condition"
      const base = defaultConsequence(type)
      const outcome = outcomeValues.has(entry?.outcome)
         ? entry.outcome
         : base.outcome
      const target = targetValues.has(entry?.target)
         ? entry.target
         : base.target
      const durationUnit = CONSEQUENCE_DURATION_UNITS.includes(entry?.durationUnit)
         ? entry.durationUnit
         : base.durationUnit
      const ruleJson =
         typeof entry?.ruleJson === "string"
            ? entry.ruleJson
            : entry?.rule
              ? JSON.stringify(entry.rule, null, 2)
              : base.ruleJson
      return {
         ...base,
         outcome,
         type,
         target,
         condition: slugify(entry?.condition || base.condition),
         value: Math.max(1, parseInt(entry?.value) || 1),
         hasDuration: !!entry?.hasDuration,
         durationUnit,
         durationValue: Math.max(1, parseInt(entry?.durationValue) || 1),
         effectUuid: String(entry?.effectUuid || entry?.uuid || "").trim(),
         ruleJson,
         damageParts: normalizeDamageParts(entry?.damageParts),
         healParts: normalizeHealParts(entry?.healParts),
         save: CONSEQUENCE_SAVES.includes(entry?.save) ? entry.save : base.save,
         dc: String(entry?.dc ?? "").trim(),
         basicSave: !!entry?.basicSave,
         basicDamageParts: normalizeDamageParts(entry?.basicDamageParts),
         consequences: normalizeConsequences(entry?.consequences, {
            allowSavingThrow: false,
         }),
      }
   })
}

function conditionDocument(slug) {
   try {
      return game.pf2e?.ConditionManager?.getCondition?.(slug) || null
   } catch (_err) {
      return null
   }
}

export function conditionOptions(selected) {
   const configured = CONFIG?.PF2E?.conditionTypes || {}
   const entries = Object.entries(configured)
   const fallback = [
      "blinded",
      "clumsy",
      "confused",
      "dazzled",
      "deafened",
      "doomed",
      "drained",
      "dying",
      "enfeebled",
      "fascinated",
      "fatigued",
      "frightened",
      "grabbed",
      "hidden",
      "immobilized",
      "off-guard",
      "paralyzed",
      "persistent-damage",
      "prone",
      "quickened",
      "sickened",
      "slowed",
      "stunned",
      "stupefied",
      "unconscious",
      "wounded",
   ].map((slug) => [slug, capitalize(slug.replace(/-/g, " "))])
   return (entries.length ? entries : fallback)
      .map(([value, label]) => ({
         value,
         label: game.i18n.localize(label) || capitalize(value),
         selected: value === selected,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
}

export function conditionIcon(slug) {
   return (
      conditionDocument(slug)?.img ||
      "systems/pf2e/icons/default-icons/condition.svg"
   )
}

export function conditionHasValue(slug) {
   const doc = conditionDocument(slug)
   const systemValue = doc?.system?.value
   if (systemValue?.isValued === true) return true
   if (Number.isFinite(Number(systemValue?.value))) return true
   return VALUED_CONDITIONS.has(slug)
}

export function enrichDamageParts(parts) {
   return normalizeDamageParts(parts).map((dp, i) => ({
      ...dp,
      index: i,
      dieOptions: DIE_SIZES.map((d) => ({
         value: d,
         selected: d === dp.die,
      })),
      typeOptions: PF2E_DAMAGE_TYPES.map((t) => ({
         value: t,
         label: capitalize(t),
         selected: t === dp.type,
      })),
      categoryOptions: DAMAGE_CATEGORIES.map((c) => ({
         value: c,
         label: capitalize(c),
         selected: c === dp.category,
      })),
   }))
}

export function enrichHealParts(parts) {
   return normalizeHealParts(parts).map((hp, i) => ({
      ...hp,
      index: i,
      dieOptions: DIE_SIZES.map((d) => ({
         value: d,
         selected: d === hp.die,
      })),
   }))
}

export function enrichConsequences(flags) {
   return enrichConsequenceList(flags.consequences, {
      allowSavingThrow: true,
   })
}

export function enrichConsequenceList(raw, { allowSavingThrow = true } = {}) {
   const types = allowSavingThrow
      ? CONSEQUENCE_TYPES
      : CONSEQUENCE_TYPES_WITHOUT_SAVE
   return normalizeConsequences(raw, { allowSavingThrow }).map((entry, i) => {
      const isCondition =
         entry.type === "apply-condition" || entry.type === "remove-condition"
      const isEffect = entry.type === "apply-effect" || entry.type === "remove-effect"
      const isRule = entry.type === "apply-rule-element"
      const isDamage = entry.type === "deal-damage"
      const isHeal = entry.type === "heal"
      const isSavingThrow = entry.type === "saving-throw"
      return {
         ...entry,
         index: i,
         isCondition,
         isEffect,
         isRule,
         isDamage,
         isHeal,
         isSavingThrow,
         saveConsequences: enrichConsequenceList(entry.consequences, {
            allowSavingThrow: false,
         }),
         basicDamageParts: enrichDamageParts(entry.basicDamageParts),
         saveOptions: CONSEQUENCE_SAVES.map((save) => ({
            value: save,
            label: capitalize(save),
            selected: save === entry.save,
         })),
         conditionIcon: conditionIcon(entry.condition),
         conditionHasValue: conditionHasValue(entry.condition),
         outcomeOptions: CONSEQUENCE_OUTCOMES.map((option) => ({
            value: option.value,
            label: tKey(option.labelKey),
            selected: option.value === entry.outcome,
         })),
         typeOptions: types.map((option) => ({
            value: option.value,
            label: tKey(option.labelKey),
            selected: option.value === entry.type,
         })),
         targetOptions: CONSEQUENCE_TARGETS.map((option) => ({
            value: option.value,
            label: tKey(option.labelKey),
            selected: option.value === entry.target,
         })),
         durationUnitOptions: CONSEQUENCE_DURATION_UNITS.map((unit) => ({
            value: unit,
            label: tKey(`ActionTab.DurationUnit.${unit}`),
            selected: unit === entry.durationUnit,
         })),
         conditionOptions: conditionOptions(entry.condition),
         damageParts: enrichDamageParts(entry.damageParts),
         healParts: enrichHealParts(entry.healParts),
      }
   })
}
