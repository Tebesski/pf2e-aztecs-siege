import { MODULE_ID, WEAPON_PROFS, CROWN_IMG } from "./constants.mjs"
export {
   validImg,
   clampPortraitOffset,
   portraitImgStyle,
   portraitBackgroundImgStyle,
   normalizePortraitData,
} from "./utils/portrait.mjs"

export const t = (key, data) =>
   data ? game.i18n.format(key, data) : game.i18n.localize(key)

export const tKey = (suffix, data) => t(`PF2E-AZTECS-SIEGE.${suffix}`, data)

export const slugify = (text) =>
   (text || "")
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

export const splitCSV = (str) =>
   str
      ? str
           .split(",")
           .map((s) => s.trim())
           .filter(Boolean)
      : []

export const splitBulk = (rawBulk) => {
   const tenths = Math.round((Number(rawBulk) || 0) * 10)
   const whole = Math.floor(tenths / 10)
   const light = tenths - whole * 10
   return { whole, light }
}

export const formatBulk = (rawBulk) => {
   const { whole, light } = splitBulk(rawBulk)
   if (whole > 0 && light > 0) return `${whole}, ${light}L`
   if (whole > 0) return `${whole}`
   if (light > 0) return `${light}L`
   return "0"
}

export const clampLevel = (level) =>
   Math.max(0, Math.min(25, parseInt(level) || 0))

export const isSiege = (actor) =>
   actor?.type === "vehicle" && actor.getFlag(MODULE_ID, "isSiegeWeapon")

export const isEnterableVehicle = (actor) =>
   actor?.type === "vehicle" &&
   !actor.getFlag(MODULE_ID, "isSiegeWeapon") &&
   !!actor.getFlag(MODULE_ID, "enterable")

export const renderHbs = (path, data) => {
   const fn = foundry.applications?.handlebars?.renderTemplate || renderTemplate
   return fn(path, data)
}

export const tplPath = (relative) =>
   `modules/${MODULE_ID}/templates/${relative}`

export const capitalize = (s) =>
   s ? s.charAt(0).toUpperCase() + s.slice(1) : ""

export const getCostGlyph = (item) => {
   const type = item.system?.actionType?.value
   const val = item.system?.actions?.value
   if (type === "action" && val)
      return `<span class="action-glyph">${val}</span>`
   if (type === "reaction") return `<span class="action-glyph">R</span>`
   if (type === "free") return `<span class="action-glyph">F</span>`
   return ""
}

export const formatProficiency = (p) => {
   if (p.name === "lore") {
      if (!p.loreName) return tKey("Skills.Lore")
      const clean = p.loreName.replace(/-lore$/i, "").replace(/-/g, " ")
      const titled = clean.replace(/\b\w/g, (c) => c.toUpperCase())
      return tKey("Skills.LoreSuffix", { name: titled })
   }
   const cap = capitalize(p.name)
   return WEAPON_PROFS.includes(p.name)
      ? tKey("Skills.WeaponSuffix", { name: cap })
      : cap
}

export const getProficiencies = (flag) =>
   flag.proficiencies || [
      { name: flag.weaponProficiency || "martial", loreName: "" },
   ]

export const primaryWeaponProf = (flag) =>
   getProficiencies(flag).find((p) => WEAPON_PROFS.includes(p.name))?.name ||
   "martial"

export const getSiegeTokenId = (siege) =>
   siege.getActiveTokens()[0]?.document?.id || null

export const ensureSiegeRoll = (siege) => [
   "siege-weapon",
   `siege-weapon:${slugify(siege.name)}`,
]

export const siegeStrikeSlug = (siege, strikeLabel) =>
   `siege-${slugify(siege?.name || "weapon")}-${slugify(strikeLabel)}`

const _strikeOptionSet = (strike) => {
   const options = new Set()
   for (const option of strike?.options || []) options.add(String(option))
   for (const option of strike?.item?.system?.options?.value || [])
      options.add(String(option))
   try {
      for (const option of strike?.item?.getRollOptions?.("item") || [])
         options.add(String(option))
   } catch {
      
   }
   return options
}

export const findMountedSiegeStrike = (actor, strikeLabel, siege) => {
   const strikes =
      actor?.system?.actions?.filter(
         (action) => action.type === "strike" && action.label === strikeLabel,
      ) || []
   if (strikes.length === 0) return null

   const expectedSlug = siegeStrikeSlug(siege, strikeLabel)
   const siegeOption = `siege-weapon:${slugify(siege?.name || "")}`
   const mountedEffectId = actor?.itemTypes?.effect?.find(
      (effect) => effect.getFlag(MODULE_ID, "siegeId") === siege?.id,
   )?.id
   return (
      strikes.find(
         (strike) =>
            mountedEffectId &&
            (strike.item?.id === mountedEffectId ||
               strike.sourceId === mountedEffectId),
      ) ||
      strikes.find(
         (strike) =>
            strike.slug === expectedSlug ||
            strike.item?.slug === expectedSlug ||
            strike.item?.system?.slug === expectedSlug,
      ) ||
      strikes.find((strike) => {
         const options = _strikeOptionSet(strike)
         return options.has(siegeOption) || options.has("siege-weapon")
      }) ||
      strikes[0]
   )
}

const SIEGE_UNLIMITED_RANGE = 999999

export const buildStrikeRange = (flag) => {
   if (flag?.isRanged === false) return null
   const increment = Math.floor(Number(flag?.rangeIncrement))
   const max = Math.floor(Number(flag?.maxRange))
   const range = {}
   if (Number.isFinite(increment) && increment >= 5) range.increment = increment
   if (Number.isFinite(max) && max >= 5) range.max = max
   if (!range.increment && !range.max) range.max = SIEGE_UNLIMITED_RANGE
   return range
}

export const buildStrikeRules = (siege, flag, actor = null) => {
   const siegeSlug = slugify(siege.name)
   const rules = []
   const baseDamage = flag.damageParts?.[0] ?? {
      dice: 1,
      die: "d6",
      type: "bludgeoning",
      category: "normal",
   }
   const baseIsFlat = baseDamage.die === "-"
   const rollOpts = ensureSiegeRoll(siege)
   rollOpts.push(...splitCSV(flag.rollOptions))

   const strikeRule = {
      key: "Strike",
      label: flag.strikeLabel,
      slug: siegeStrikeSlug(siege, flag.strikeLabel),
      category: primaryWeaponProf(flag),
      traits: splitCSV(flag.traits),
      damage: {
         base: {
            damageType: baseDamage.type || "bludgeoning",
            dice: baseIsFlat ? 0 : baseDamage.dice || 1,
            die: baseIsFlat ? "d4" : baseDamage.die,
            modifier: Number(baseDamage.modifier) || 0,
         },
      },
      options: rollOpts,
   }

   if (actor?.type === "npc") strikeRule.attackModifier = 1

   if (flag.isRanged !== false) {
      strikeRule.group = "firearm"
      strikeRule.range = buildStrikeRange(flag)
   } else {
      strikeRule.group = "brawling"
   }

   rules.push(strikeRule)

   const abilitySlugs = [
      "str",
      "dex",
      "con",
      "int",
      "wis",
      "cha",
      "strength",
      "dexterity",
      "constitution",
      "intelligence",
      "wisdom",
      "charisma",
   ]

   for (const slug of abilitySlugs) {
      rules.push({
         key: "AdjustModifier",
         selector: "strike-damage",
         slug,
         predicate: [`siege-weapon:${siegeSlug}`],
         suppress: true,
      })
      rules.push({
         key: "AdjustModifier",
         selector: "damage",
         slug,
         predicate: [`siege-weapon:${siegeSlug}`],
         suppress: true,
      })
   }

   if (baseIsFlat && baseDamage.dice > 0) {
      rules.push({
         key: "FlatModifier",
         selector: "strike-damage",
         predicate: [`siege-weapon:${siegeSlug}`],
         value: baseDamage.dice,
         type: "untyped",
         label: tKey("Modifiers.BaseDamage"),
      })
   }

   if (flag.damageParts && flag.damageParts.length > 1) {
      for (let j = 1; j < flag.damageParts.length; j++) {
         const dp = flag.damageParts[j]
         const cat = dp.category === "normal" ? null : dp.category
         if (dp.die === "-") {
            rules.push({
               key: "FlatModifier",
               slug: `siege-flat-damage-${j}`,
               selector: "strike-damage",
               predicate: [`siege-weapon:${siegeSlug}`],
               value: dp.dice || 0,
               type: "untyped",
               damageType: dp.type || "bludgeoning",
               damageCategory: cat,
               label: tKey("Modifiers.AdditionalDamage"),
            })
         } else {
            rules.push({
               key: "DamageDice",
               slug: `siege-dice-damage-${j}`,
               selector: "strike-damage",
               predicate: [`siege-weapon:${siegeSlug}`],
               diceNumber: dp.dice || 0,
               dieSize: dp.die,
               damageType: dp.type || "bludgeoning",
               category: cat,
            })
         }
      }
   }

   const attackBonus = parseInt(flag.attackBonus) || 0
   if (attackBonus !== 0) {
      rules.push({
         key: "FlatModifier",
         selector: "strike-attack-roll",
         predicate: [`siege-weapon:${siegeSlug}`],
         value: attackBonus,
         type: "untyped",
         label: tKey("Modifiers.SiegeBaseBonus"),
      })
   }

   const material = slugify(flag.material || "")
   if (material) {
      rules.push({
         key: "AdjustStrike",
         mode: "add",
         property: "materials",
         value: material,
         predicate: [`siege-weapon:${siegeSlug}`],
      })
   }

   return rules
}

const SIEGE_OFFENSIVE_SELECTORS = new Set([
   "attack",
   "attack-roll",
   "strike-attack-roll",
   "damage",
   "damage-roll",
   "strike-damage",
])

const _ruleSelectors = (rule) =>
   Array.isArray(rule?.selector)
      ? rule.selector.map((s) => String(s))
      : rule?.selector
        ? [String(rule.selector)]
        : []

const _isOffensiveSiegeRule = (rule) => {
   if (!rule || typeof rule !== "object") return false
   if (rule.key === "AdjustStrike") return true
   return _ruleSelectors(rule).some((selector) =>
      SIEGE_OFFENSIVE_SELECTORS.has(selector),
   )
}

const _predicateStrings = (value, out = new Set()) => {
   if (typeof value === "string") out.add(value)
   else if (Array.isArray(value)) value.forEach((entry) => _predicateStrings(entry, out))
   else if (value && typeof value === "object")
      Object.values(value).forEach((entry) => _predicateStrings(entry, out))
   return out
}

const _actorReferencePaths = (value, out = new Set()) => {
   if (typeof value === "string") {
      for (const match of value.matchAll(/@actor\.([\w.\-]+)/g)) out.add(match[1])
   } else if (Array.isArray(value)) {
      value.forEach((entry) => _actorReferencePaths(entry, out))
   } else if (value && typeof value === "object") {
      Object.values(value).forEach((entry) => _actorReferencePaths(entry, out))
   }
   return out
}

const OFFENSIVE_EFFECT_RULES_FLAG = "offensiveEffectRulesSource"

const _effectOrigin = (effect, siege, fallbackActor = null) => {
   if (fallbackActor) return fallbackActor
   const origin = effect?.origin
   if (origin?.documentName || origin?.system || origin?.actor) return origin.actor || origin
   const originUuid =
      effect?.system?.context?.origin?.uuid ||
      effect?.flags?.pf2e?.origin?.uuid ||
      ""
   if (originUuid && typeof fromUuidSync === "function") {
      try {
         const doc = fromUuidSync(originUuid)
         if (doc) return doc.actor || doc
      } catch {
         
      }
   }
   return fallbackActor || siege
}

const _numericPath = (document, path, fallbackActor = null) => {
   if (!document) return NaN
   const rollData = (() => {
      try {
         return document.getRollData?.() || {}
      } catch {
         return {}
      }
   })()
   const direct = Number(foundry.utils.getProperty(rollData, path))
   if (Number.isFinite(direct)) return direct
   const docDirect = Number(foundry.utils.getProperty(document, path))
   if (Number.isFinite(docDirect)) return docDirect
   const systemDirect = Number(foundry.utils.getProperty(document.system || {}, path))
   if (Number.isFinite(systemDirect)) return systemDirect
   if (path === "level") {
      const level = Number(
         document.level ??
            document.system?.details?.level?.value ??
            document.system?.level?.value ??
            fallbackActor?.system?.details?.level?.value ??
            fallbackActor?.system?.level?.value,
      )
      if (Number.isFinite(level)) return level
   }
   return NaN
}

const _replaceRuleRefs = (
   value,
   {
      effect,
      siege,
      fallbackActor = null,
      protectedActorPaths = new Set(),
      unresolvedItemOrigin = null,
   } = {},
) => {
   if (Array.isArray(value))
      return value.map((entry) =>
         _replaceRuleRefs(entry, {
            effect,
            siege,
            fallbackActor,
            protectedActorPaths,
            unresolvedItemOrigin,
         }),
      )
   if (value && typeof value === "object") {
      const clone = foundry.utils.deepClone(value)
      for (const [key, entry] of Object.entries(clone)) {
         clone[key] = _replaceRuleRefs(entry, {
            effect,
            siege,
            fallbackActor,
            protectedActorPaths,
            unresolvedItemOrigin,
         })
      }
      return clone
   }
   if (typeof value !== "string") return value
   const origin = _effectOrigin(effect, siege, fallbackActor)
   let next = value.replace(/@item\.origin\.([\w.\-]+)/g, (match, path) => {
      const resolved = _numericPath(origin, path, siege)
      if (Number.isFinite(resolved)) return `(${resolved})`
      return unresolvedItemOrigin ?? match
   })
   next = next.replace(/@actor\.([\w.\-]+)/g, (match, path) => {
      if (protectedActorPaths.has(path)) return match
      const resolved = _numericPath(siege, path)
      return Number.isFinite(resolved) ? `(${resolved})` : match
   })
   return next
}

const _withSiegePredicate = (rule, siegeOption) => {
   const clone = foundry.utils.deepClone(rule)
   const predicate = clone.predicate
   const hasOption = _predicateStrings(predicate).has(siegeOption)
   if (hasOption) return clone
   if (Array.isArray(predicate)) clone.predicate = [...predicate, siegeOption]
   else if (predicate) clone.predicate = [predicate, siegeOption]
   else clone.predicate = [siegeOption]
   return clone
}

const _mirrorRule = (rule, effect, siege, protectedActorPaths, gate, actor = null) => {
   const siegeOption = `siege-weapon:${slugify(siege.name)}`
   const clone = gate ? _withSiegePredicate(rule, siegeOption) : foundry.utils.deepClone(rule)
   if (clone.value !== undefined)
      clone.value = _replaceRuleRefs(clone.value, {
         effect,
         siege,
         fallbackActor: actor,
         protectedActorPaths,
         unresolvedItemOrigin: "0",
   })
   clone.slug = clone.slug || slugify(`${effect.name}-${clone.key || "rule"}`)
   clone.label = clone.label || effect.name
   return clone
}

const _choiceSelection = (rule, effect) => {
   if (
      typeof rule.selection === "string" ||
      typeof rule.selection === "number" ||
      typeof rule.selection === "boolean"
   )
      return rule.selection
   const flag = rule.flag || ""
   if (!flag) return null
   const selected = effect.flags?.pf2e?.rulesSelections?.[flag]
   if (typeof selected === "string" || typeof selected === "number")
      return selected

   const effectSlug = slugify(effect.name)
   const choices = Array.isArray(rule.choices) ? rule.choices : []
   return (
      choices
         .map((choice) => choice?.value)
         .filter((value) => typeof value === "string" || typeof value === "number")
         .sort((a, b) => String(b).length - String(a).length)
         .find((value) => effectSlug.includes(slugify(String(value)))) || null
   )
}

const _offensiveEffectRules = (effect) => {
   const sourceRules = effect.getFlag?.(MODULE_ID, OFFENSIVE_EFFECT_RULES_FLAG)
   return Array.isArray(sourceRules) ? sourceRules : effect.system?.rules || []
}

const _offensiveRuleContext = (rules) => {
   const usableRules = rules.filter((rule) => !rule.ignored)
   const offensive = usableRules.filter(_isOffensiveSiegeRule)
   if (offensive.length === 0) return null

   const neededOptions = new Set()
   const neededPaths = new Set()
   for (const rule of offensive) {
      _predicateStrings(rule.predicate).forEach((entry) => neededOptions.add(entry))
      _actorReferencePaths(rule.value).forEach((entry) => neededPaths.add(entry))
   }

   const protectedActorPaths = new Set()
   for (const rule of usableRules) {
      if (rule.key === "ActiveEffectLike" && neededPaths.has(rule.path))
         protectedActorPaths.add(rule.path)
   }

   const includeRule = (rule) => {
      if (_isOffensiveSiegeRule(rule)) return true
      if (rule.key === "ActiveEffectLike" && neededPaths.has(rule.path)) return true
      if (rule.key === "ChoiceSet") return false
      if (rule.key === "RollOption") {
         const option = String(rule.option || "")
         if (option && neededOptions.has(option)) return true
         return [..._predicateStrings(rule.predicate)].some((option) =>
            neededOptions.has(option),
         )
      }
      return false
   }

   return { usableRules, neededOptions, protectedActorPaths, includeRule }
}

export const siegeOffensiveEffectRuleUpdates = (siege) => {
   if (!siege?.itemTypes?.effect) return []

   const updates = []
   for (const effect of siege.itemTypes.effect) {
      const rules = effect.system?.rules || []
      if (!Array.isArray(rules) || rules.length === 0) continue
      const ctx = _offensiveRuleContext(rules)
      if (!ctx) continue

      const nextRules = foundry.utils.deepClone(rules)
      let changed = false
      for (let idx = 0; idx < nextRules.length; idx++) {
         const rule = nextRules[idx]
         if (!ctx.includeRule(rule) || rule.value === undefined) continue
         const nextValue = _replaceRuleRefs(rule.value, {
            effect,
            siege,
            protectedActorPaths: ctx.protectedActorPaths,
            unresolvedItemOrigin: "0",
         })
         if (JSON.stringify(nextValue) === JSON.stringify(rule.value)) continue
         rule.value = nextValue
         changed = true
      }

      if (!changed) continue
      const update = { _id: effect.id, "system.rules": nextRules }
      if (!effect.getFlag?.(MODULE_ID, OFFENSIVE_EFFECT_RULES_FLAG))
         update[`flags.${MODULE_ID}.${OFFENSIVE_EFFECT_RULES_FLAG}`] =
            foundry.utils.deepClone(rules)
      updates.push(update)
   }
   return updates
}

export const buildSiegeOffensiveEffectRules = (siege, actor = null) => {
   if (!siege?.itemTypes?.effect) return []

   const mirrored = []
   for (const effect of siege.itemTypes.effect) {
      const ctx = _offensiveRuleContext(_offensiveEffectRules(effect))
      if (!ctx) continue
      const { usableRules: rules, neededOptions, protectedActorPaths, includeRule } = ctx
      if (!Array.isArray(rules) || rules.length === 0) continue

      for (const rule of rules) {
         if (rule.key !== "ChoiceSet") continue
         const rollOption = String(rule.rollOption || rule.slug || "")
         if (!rollOption) continue
         if (
            ![...neededOptions].some(
               (option) =>
                  option === rollOption || option.startsWith(`${rollOption}:`),
            )
         )
            continue
         const selection = _choiceSelection(rule, effect)
         if (selection == null || typeof selection === "boolean") continue
         mirrored.push(
            _mirrorRule(
               {
                  key: "RollOption",
                  option: `${rollOption}:${selection}`,
               },
               effect,
               siege,
               protectedActorPaths,
               false,
               actor,
            ),
         )
      }

      for (const rule of rules.filter(includeRule)) {
         mirrored.push(
            _mirrorRule(
               rule,
               effect,
               siege,
               protectedActorPaths,
               _isOffensiveSiegeRule(rule),
               actor,
            ),
         )
      }
   }
   return mirrored
}

export const buildMountedSiegeRules = (
   siege,
   chosenPosition,
   actor = null,
   options = {},
) => {
   const rules = []
   for (const action of siege.items.filter((item) => item.type === "action")) {
      const actionFlag = action.getFlag(MODULE_ID, "siegeAction")
      if (!actionFlag || !actionFlag.isStrike) continue
      if (
         chosenPosition &&
         actionFlag.crewAccess?.length > 0 &&
         !actionFlag.crewAccess.includes(chosenPosition)
      )
         continue

      const isActive =
         action.id === options.actionId || action.name === options.strikeLabel
      const effectiveFlag = isActive && options.flag ? options.flag : actionFlag
      const damageParts =
         isActive && options.versatileType
            ? [
                 {
                    ...(effectiveFlag.damageParts?.[0] || {}),
                    type: options.versatileType,
                 },
                 ...(effectiveFlag.damageParts || []).slice(1),
              ]
            : effectiveFlag.damageParts
      rules.push(
         ...buildStrikeRules(
            siege,
            {
               ...effectiveFlag,
               strikeLabel: action.name,
               damageParts,
            },
            actor,
         ),
      )
   }
   rules.push(...buildSiegeOffensiveEffectRules(siege, actor))
   return rules
}

export const getAllActors = () =>
   new Set([
      ...game.actors,
      ...(canvas?.tokens?.placeables?.map((tok) => tok.actor).filter(Boolean) ||
         []),
   ])

export const getCrewActors = (siege) => {
   const seen = new Map()
   for (const actor of getAllActors()) {
      if (seen.has(actor.id)) continue
      const onSiege = actor.itemTypes.effect.some(
         (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (onSiege) seen.set(actor.id, actor)
   }
   return [...seen.values()]
}

export const countOccupants = (siege, position = null) => {
   let count = 0
   for (const actor of getCrewActors(siege)) {
      if (
         actor.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId") === siege.id &&
               (position === null ||
                  e.getFlag(MODULE_ID, "position") === position),
         )
      )
         count++
   }
   return count
}

export const findCrewmenOf = (siege) =>
   game.actors.filter((a) =>
      a.itemTypes.effect.some(
         (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
      ),
   )

export const findLeaderEffect = (siege) => {
   for (const actor of getAllActors()) {
      const eff = actor.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "isCrewLeader") &&
            e.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (eff) return eff
   }
   return null
}

export const isSiegeLifted = (siege) =>
   (siege.system.traits?.value || []).includes("portable") &&
   siege.itemTypes.effect.some(
      (e) =>
         e.name === tKey("Markers.Lifted") &&
         e.getFlag(MODULE_ID, "isPortableMarker"),
   )

export const buildCrewLeaderEffect = (siegeId) => ({
   name: tKey("Markers.CrewLeader"),
   type: "effect",
   img: CROWN_IMG,
   system: {
      level: { value: 1 },
      description: { value: "" },
      tokenIcon: { show: true },
   },
   flags: { [MODULE_ID]: { isCrewLeader: true, siegeId } },
})

export const makeModifier = (slug, label, value, type = "untyped") => {
   if (!game.pf2e?.Modifier) return null
   return new game.pf2e.Modifier({ slug, label, modifier: value, type })
}
