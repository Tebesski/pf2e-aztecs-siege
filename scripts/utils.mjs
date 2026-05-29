import { MODULE_ID, WEAPON_PROFS } from "./constants.mjs"

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

export const validImg = (src, fallback) =>
   typeof src === "string" && src.trim() !== "" && !/\.(webm|mp4)$/i.test(src)
      ? src
      : fallback

export const clampLevel = (level) =>
   Math.max(0, Math.min(25, parseInt(level) || 0))

export const isSiege = (actor) =>
   actor?.type === "vehicle" && actor.getFlag(MODULE_ID, "isSiegeWeapon")

export const renderHbs = (path, data) => {
   const fn =
      foundry.applications?.handlebars?.renderTemplate || renderTemplate
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

export const buildStrikeRules = (siege, flag) => {
   const siegeSlug = slugify(siege.name)
   const rules = []
   const baseDamage =
      flag.damageParts?.[0] ?? {
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
      category: primaryWeaponProf(flag),
      traits: splitCSV(flag.traits),
      damage: {
         base: {
            damageType: baseDamage.type || "bludgeoning",
            dice: baseIsFlat ? 0 : baseDamage.dice || 1,
            die: baseIsFlat ? "d4" : baseDamage.die,
         },
      },
      options: rollOpts,
   }

   if (flag.isRanged !== false) {
      const rInc = parseInt(flag.rangeIncrement)
      if (!isNaN(rInc)) strikeRule.rangeIncrement = rInc
   }
   rules.push(strikeRule)

   for (const slug of ["strength", "dexterity"]) {
      rules.push({
         key: "AdjustModifier",
         selector: "strike-damage",
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

   return rules
}

export const countOccupants = (siege, position = null) => {
   let count = 0
   for (const actor of game.actors) {
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
      a.itemTypes.effect.some((e) => e.getFlag(MODULE_ID, "siegeId") === siege.id),
   )

export const makeModifier = (slug, label, value, type = "untyped") => {
   if (!game.pf2e?.Modifier) return null
   return new game.pf2e.Modifier({ slug, label, modifier: value, type })
}
