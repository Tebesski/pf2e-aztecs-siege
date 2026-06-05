import { MODULE_ID, WEAPON_PROFS, CROWN_IMG } from "./constants.mjs"

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

   
   
   
   
   
   
   if (actor?.type === "npc") {
      const npcAttack = npcNativeAttackBonus(actor)
      if (npcAttack !== null) {
         rules.push({
            key: "FlatModifier",
            selector: "strike-attack-roll",
            predicate: [`siege-weapon:${siegeSlug}`],
            value: npcAttack,
            type: "untyped",
            label: tKey("Modifiers.NpcProficiency"),
         })
      }
   }

   return rules
}





export const npcNativeAttackBonus = (actor) => {
   const attackItems = actor?.items?.filter((i) => i.type === "melee") ?? []
   let best = null
   for (const item of attackItems) {
      const v = Number(item.system?.bonus?.value)
      if (!Number.isNaN(v) && (best === null || v > best)) best = v
   }
   return best
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
      description: { value: tKey("Markers.CrewLeaderDesc") },
      tokenIcon: { show: true },
   },
   flags: { [MODULE_ID]: { isCrewLeader: true, siegeId } },
})

export const makeModifier = (slug, label, value, type = "untyped") => {
   if (!game.pf2e?.Modifier) return null
   return new game.pf2e.Modifier({ slug, label, modifier: value, type })
}






export const clampPortraitOffset = (offset, zoom) => {
   const z = Math.max(1, Number(zoom) || 1)
   const limitPctOfBox = (1 - 1 / z) * 50 
   const o = Number(offset) || 0
   return Math.max(-limitPctOfBox, Math.min(limitPctOfBox, o))
}







export const portraitImgStyle = (p) => {
   const zoom = Math.max(1, p?.zoom ?? p?.scale ?? 1)
   const ox = clampPortraitOffset(p?.ox ?? p?.offsetX ?? 0, zoom)
   const oy = clampPortraitOffset(p?.oy ?? p?.offsetY ?? 0, zoom)
   const posX = 50 + ox
   const posY = 50 + oy
   return `position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:${posX}% ${posY}%; transform:scale(${zoom}); transform-origin:${posX}% ${posY}%;`
}
