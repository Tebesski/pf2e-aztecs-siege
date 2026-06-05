import { MODULE_ID } from "../constants.mjs"
import { splitCSV, tKey, getCostGlyph } from "../utils.mjs"
import {
   getAmmoInfo,
   computePrereqData,
   computeCornerShot,
   buildDamageTagsHtml,
   versatileOptionsFor,
   computeBestModifier,
   formatSignedMod,
   resolveActionDC,
   resolveSaveDC,
} from "./helpers.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { ammoTypesAccordionHTML } from "../ui/ammo-details.mjs"

export function resolveCrewman() {
   const controlled = canvas.tokens.controlled
   if (controlled.length !== 1) {
      ui.notifications.warn(tKey("Notifications.SelectExactlyOneCrewman"))
      return null
   }
   return controlled[0].actor
}

export async function resolveMountedSiege(crewman) {
   const effects = crewman.itemTypes.effect.filter((e) =>
      e.getFlag(MODULE_ID, "siegeId"),
   )
   if (effects.length === 0) {
      ui.notifications.warn(tKey("Notifications.NotMountedOnSiege"))
      return null
   }

   
   
   const effect =
      effects.find((e) => e.getFlag(MODULE_ID, "isEntered")) || effects[0]
   const siegeUuid = effect.getFlag(MODULE_ID, "siegeUuid")
   const siegeId = effect.getFlag(MODULE_ID, "siegeId")
   const position = effect.getFlag(MODULE_ID, "position")

   let siege = null
   if (siegeUuid) siege = await fromUuid(siegeUuid)
   if (!siege && siegeId) siege = game.actors.get(siegeId)
   if (!siege) {
      ui.notifications.warn(tKey("Notifications.SiegeWeaponNotFound"))
      return null
   }
   return { siege, position }
}

export function buildI18nLabels() {
   return {
      noCrew: tKey("ActionMacro.NoCrewToPerform"),
      shorthandedActive: tKey("ActionMacro.ShorthandedActive"),
      penaltyApplied: tKey("ActionMacro.PenaltyApplied"),
      repair: tKey("ActionMacro.Repair"),
      delegateWeight: tKey("ActionMacro.DelegateWeight"),
      takeLeadership: tKey("ActionMacro.TakeLeadership"),
      delegateLeadership: tKey("ActionMacro.DelegateLeadership"),
      currentlyLifting: tKey("ActionMacro.CurrentlyLifting"),
      ammunition: tKey("ActionMacro.Ammunition"),
      ammunitionTypes: tKey("Weaponry.AmmunitionTypes"),
      loaded: tKey("AttackTemplates.Loaded.Name"),
      area: tKey("ActionMacro.Area"),
      saveDC: tKey("ActionMacro.SaveDC"),
      damage: tKey("ActionMacro.Damage"),
      range: tKey("ActionMacro.Range"),
      cornerShot: tKey("ActionMacro.CornerShot"),
      lethalAttack: tKey("ActionMacro.LethalAttack"),
      highestStrInCrew: tKey("ActionMacro.HighestStrInCrew"),
      vehiclePenalties: tKey("ActionMacro.VehiclePenalties"),
      penalty2: tKey("ActionMacro.Penalty2"),
      penalty4: tKey("ActionMacro.Penalty4"),
      attackingFromVehiclePenalty: tKey("ActionMacro.AttackingFromVehiclePenalty"),
      attackingFromVehiclePenaltyTip: tKey("ActionMacro.AttackingFromVehiclePenaltyTip"),
      noVehiclePenalty: tKey("ActionMacro.NoVehiclePenalty"),
      uncontrolledPenalty: tKey("ActionMacro.UncontrolledPenalty"),
      traits: tKey("ActionMacro.Traits"),
      prerequisites: tKey("ActionMacro.Prerequisites"),
      strikesSection: tKey("ActionMacro.StrikesSection"),
      actionsSection: tKey("ActionMacro.ActionsSection"),
      exitVehicle: tKey("CrewHUD.Exit"),
      ignitionRequired: tKey("ActionMacro.IgnitionRequired"),
   }
}

export function buildActionData(a, siege, crewman, autoDC, isPortable) {
   const rawFlag = { skills: [], ...(a.getFlag(MODULE_ID, "siegeAction") || {}) }
   const ammoPayload =
      rawFlag.usesAmmunition !== false && (rawFlag.isAttack || rawFlag.isStrike)
         ? AmmunitionManager.activeAmmoPayload(siege, a)
         : null
   const flag = ammoPayload
      ? AmmunitionManager.applyAmmoOverridesToFlag(rawFlag, ammoPayload)
      : rawFlag
   const prereqData = computePrereqData(siege, flag, a)
   const {
      name: ammoName,
      loaded: ammoLoaded,
      max: ammoMax,
   } = getAmmoInfo(siege, flag, a)
   const cornerShot = computeCornerShot(crewman, flag)

   const rawTraits = splitCSV(flag.traits).map((t) => t.toLowerCase())
   const hasNonlethal = rawTraits.includes("nonlethal")
   const versatileOptions = versatileOptionsFor(flag)
   const isStrikeAction = flag.isStrike || flag.isAttack
   const isAbility = flag.isAttack && !flag.isStrike
   const usesAmmunition =
      isStrikeAction &&
      flag.usesAmmunition !== false &&
      AmmunitionManager.ammoSlugsForAction(flag).length > 0
   const damageHtml = isStrikeAction ? buildDamageTagsHtml(flag.damageParts) : ""
   const rangeParts = []
   let rangeText = ""
   if (isStrikeAction && !isAbility && flag.isRanged === false) {
      rangeText = tKey("Weaponry.Melee")
   } else if (isStrikeAction && !isAbility && flag.isRanged !== false) {
      if (flag.blindRange) rangeParts.push(`${tKey("CrewHUD.RangeBlind")} ${flag.blindRange}`)
      if (flag.minRange) rangeParts.push(`${tKey("CrewHUD.RangeMin")} ${flag.minRange}`)
      if (flag.rangeIncrement)
         rangeParts.push(`${tKey("CrewHUD.RangeInc")} ${flag.rangeIncrement}`)
      if (flag.maxRange) rangeParts.push(`${tKey("CrewHUD.RangeMax")} ${flag.maxRange}`)
      rangeText = rangeParts.length ? `${rangeParts.join(" / ")} ft` : ""
   }
   const loadedInfo = usesAmmunition
      ? AmmunitionManager.loadedInfoForAction(siege, a)
      : null

   const buttons = _buildActionButtons(a, crewman, flag, autoDC, siege)

   return {
      id: a.id,
      name: a.name,
      img: a.img,
      description: a.system.description.value,
      costGlyph: getCostGlyph(a),
      buttons,
      isStrike: isStrikeAction,
      needsIgnition: flag.needsIgnition !== false,
      isAbility,
      isRanged: flag.isRanged !== false,
      hasNonlethal,
      versatileOptions,
      damageHtml,
      showDamage: !!damageHtml,
      prereqData,
      ammoName,
      usesAmmunition,
      ammoTypesAccordionHtml: usesAmmunition
         ? ammoTypesAccordionHTML(siege, a)
         : "",
      loadedDisplay: loadedInfo?.display || "",
      ammoLoaded,
      ammoMax,
      spend: parseInt(flag.spend) || 1,
      traitsStr: flag.traits || tKey("Misc.None"),
      saveDC: resolveSaveDC(crewman, flag),
      areaSize: flag.areaSize || 5,
      areaType: flag.areaType || "burst",
      showArea: !!(flag.areaSize && flag.areaType && (flag.actionType || ammoPayload?.flags?.modifyArea)),
      blindRange: flag.blindRange || tKey("Misc.Infinity"),
      minRange: flag.minRange || "0",
      maxRange: flag.maxRange || tKey("Misc.Infinity"),
      rangeText,
      showRange: !!rangeText,
      cornerShot,
      showStrCheckbox: isPortable && flag.isStrike,
      isPortable,
   }
}

function _buildActionButtons(a, crewman, flag, autoDC, siege = null) {
   if (flag.isStrike) {
      const generatedStrike = crewman.system.actions?.find(
         (act) => act.type === "strike" && act.label === a.name,
      )
      const startMod = generatedStrike ? generatedStrike.totalModifier : 0
      const { bestMod } = computeBestModifier(crewman, flag, startMod, siege)
      return [
         {
            type: "strike",
            label: tKey("ActionMacro.LaunchAttack", {
               mod: formatSignedMod(bestMod),
            }),
         },
      ]
   }
   if (flag.isAttack) {
      return [{ type: "ability-attack", label: tKey("ActionMacro.UseAbility") }]
   }
   if (flag.skills.length > 0) {
      return flag.skills.map((s, idx) => {
         let skillMod = 0
         let displayName = s.name.toUpperCase()

         if (s.name === "lore") {
            
            
            
            const wanted = s.loreName || ""
            const wantedBase = wanted.replace(/-lore$/i, "")
            const loreSkill = Object.values(crewman.skills).find((sk) => {
               const slug = sk.slug || ""
               const slugBase = slug.replace(/-lore$/i, "")
               return slug === wanted || slugBase === wantedBase
            })
            skillMod = loreSkill ? loreSkill.mod : 0
            const clean = wantedBase.replace(/-/g, " ")
            displayName = tKey("Skills.LoreSuffix", {
               name: clean.toUpperCase(),
            })
         } else if (s.name === "perception") {
            skillMod = crewman.perception?.mod || 0
         } else {
            skillMod = crewman.skills[s.name]?.mod || 0
         }

         const targetDC = resolveActionDC(crewman, s.dc, autoDC)
         return {
            type: "skill",
            idx,
            hasIdx: true,
            label: tKey("ActionMacro.SkillBtn", {
               name: displayName,
               mod: formatSignedMod(skillMod),
               dc: targetDC,
            }),
         }
      })
   }
   return [{ type: "none", label: tKey("ActionMacro.PerformAction") }]
}
