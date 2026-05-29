import { MODULE_ID, DC_BY_LEVEL } from "../constants.mjs"
import {
   slugify,
   splitCSV,
   clampLevel,
   renderHbs,
   tplPath,
   capitalize,
   tKey,
   ensureSiegeRoll,
   makeModifier,
   getSiegeTokenId,
   getCostGlyph,
} from "../utils.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { SiegeSFXManager } from "../managers/sfx.mjs"
import {
   getActionsForCrew,
   getAmmoInfo,
   computePrereqData,
   computeCornerShot,
   buildDamageTagsHtml,
   versatileOptionsFor,
   computeCrewStatus,
   computeBestModifier,
   ensureSiegeCSS,
   formatSignedMod,
} from "./helpers.mjs"
import { repairMacro } from "./repair.mjs"
import { delegateWeightMacro } from "./delegate.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"

export async function actionMacro(crewmanActor = null) {
   const crewman = crewmanActor || _resolveCrewman()
   if (!crewman) return

   const mountInfo = await _resolveMountedSiege(crewman)
   if (!mountInfo) return
   const { siege, position } = mountInfo

   const { crewBlocked, shorthandedPenalty, missingCrewString, totalMissing } =
      computeCrewStatus(siege)
   const isPortable = (siege.system.traits?.value || []).includes("portable")

   const actions = getActionsForCrew(siege, position)
   if (actions.length === 0)
      return ui.notifications.warn(tKey("Notifications.NoAvailableActions"))

   const crewLevel = clampLevel(crewman.system.details.level?.value)
   const autoDC =
      siege.getFlag(MODULE_ID, "disableDC") || DC_BY_LEVEL[crewLevel]

   const macroActionsData = actions.map((a) =>
      _buildActionData(a, siege, crewman, autoDC, isPortable),
   )

   const myLiftedItem = isPortable
      ? crewman.items.find(
           (i) =>
              i.getFlag(MODULE_ID, "isLiftedItem") &&
              i.getFlag(MODULE_ID, "siegeId") === siege.id,
        )
      : null
   const myLiftBulk = myLiftedItem?.system?.bulk?.value || 0
   const isLifting = isPortable && myLiftBulk > 0

   const htmlContent = await renderHbs(tplPath("macros/actions.hbs"), {
      actions: macroActionsData,
      siegeName: siege.name,
      repairDC: autoDC,
      crewBlocked,
      totalMissing,
      missingCrewString,
      shorthandedPenalty,
      isPortable,
      isLifting,
      myLiftBulk,
      i18n: _buildI18nLabels(),
   })

   class SiegeActionsApp extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
         window: { title: tKey("ActionMacro.AppTitle", { name: siege.name }) },
         position: { width: 450, height: "auto" },
      }
      constructor(options) {
         super(options)
         ensureSiegeCSS()
      }
      _renderHTML() {
         return htmlContent
      }
      _replaceHTML(result, content) {
         content.innerHTML = result
      }
      _onRender() {
         _bindAppListeners(this, {
            crewman,
            siege,
            isPortable,
            crewBlocked,
            shorthandedPenalty,
            autoDC,
         })
      }
   }

   new SiegeActionsApp().render(true)
}

function _resolveCrewman() {
   const controlled = canvas.tokens.controlled
   if (controlled.length !== 1) {
      ui.notifications.warn(tKey("Notifications.SelectExactlyOneCrewman"))
      return null
   }
   return controlled[0].actor
}

async function _resolveMountedSiege(crewman) {
   const effects = crewman.itemTypes.effect.filter((e) =>
      e.getFlag(MODULE_ID, "siegeId"),
   )
   if (effects.length === 0) {
      ui.notifications.warn(tKey("Notifications.NotMountedOnSiege"))
      return null
   }

   const effect = effects[0]
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

function _buildI18nLabels() {
   return {
      noCrew: tKey("ActionMacro.NoCrewToPerform"),
      shorthandedActive: tKey("ActionMacro.ShorthandedActive"),
      penaltyApplied: tKey("ActionMacro.PenaltyApplied"),
      repair: tKey("ActionMacro.Repair"),
      delegateWeight: tKey("ActionMacro.DelegateWeight"),
      currentlyLifting: tKey("ActionMacro.CurrentlyLifting"),
      ammunition: tKey("ActionMacro.Ammunition"),
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
      traits: tKey("ActionMacro.Traits"),
      prerequisites: tKey("ActionMacro.Prerequisites"),
   }
}

function _buildActionData(a, siege, crewman, autoDC, isPortable) {
   const flag = { skills: [], ...(a.getFlag(MODULE_ID, "siegeAction") || {}) }
   const prereqData = computePrereqData(siege, flag)
   const {
      name: ammoName,
      loaded: ammoLoaded,
      max: ammoMax,
   } = getAmmoInfo(siege, flag)
   const cornerShot = computeCornerShot(crewman, flag)

   const rawTraits = splitCSV(flag.traits).map((t) => t.toLowerCase())
   const hasNonlethal = rawTraits.includes("nonlethal")
   const versatileOptions = versatileOptionsFor(flag)
   const damageHtml = buildDamageTagsHtml(flag.damageParts)

   const buttons = _buildActionButtons(a, crewman, flag, autoDC)

   return {
      id: a.id,
      name: a.name,
      img: a.img,
      description: a.system.description.value,
      costGlyph: getCostGlyph(a),
      buttons,
      isStrike: flag.isStrike || flag.isAttack,
      isAbility: flag.isAttack && !flag.isStrike,
      isRanged: flag.isRanged !== false,
      hasNonlethal,
      versatileOptions,
      damageHtml,
      prereqData,
      ammoName,
      ammoLoaded,
      ammoMax,
      spend: parseInt(flag.spend) || 1,
      traitsStr: flag.traits || tKey("Misc.None"),
      saveDC: flag.saveDC || 10,
      areaSize: flag.areaSize || 5,
      areaType: flag.areaType || "burst",
      blindRange: flag.blindRange || tKey("Misc.Infinity"),
      minRange: flag.minRange || "0",
      maxRange: flag.maxRange || tKey("Misc.Infinity"),
      cornerShot,
      showStrCheckbox: isPortable && flag.isStrike,
      isPortable,
   }
}

function _buildActionButtons(a, crewman, flag, autoDC) {
   if (flag.isStrike) {
      const generatedStrike = crewman.system.actions?.find(
         (act) => act.type === "strike" && act.label === a.name,
      )
      const startMod = generatedStrike ? generatedStrike.totalModifier : 0
      const { bestMod } = computeBestModifier(crewman, flag, startMod)
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
            const loreSkill = Object.values(crewman.skills).find(
               (sk) => sk.slug === s.loreName,
            )
            skillMod = loreSkill ? loreSkill.mod : 0
            const clean = s.loreName.replace(/-lore$/i, "").replace(/-/g, " ")
            displayName = tKey("Skills.LoreSuffix", {
               name: clean.toUpperCase(),
            })
         } else if (s.name === "perception") {
            skillMod = crewman.perception?.mod || 0
         } else {
            skillMod = crewman.skills[s.name]?.mod || 0
         }

         const targetDC = s.dc === "" || s.dc === null ? autoDC : s.dc
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

function _bindAppListeners(app, ctx) {
   const root = $(app.element)

   root.find(".veh-penalty-2").on("change", (e) => {
      if (e.target.checked)
         $(e.currentTarget)
            .closest(".vehicle-penalties")
            .find(".veh-penalty-4")
            .prop("checked", false)
   })
   root.find(".veh-penalty-4").on("change", (e) => {
      if (e.target.checked)
         $(e.currentTarget)
            .closest(".vehicle-penalties")
            .find(".veh-penalty-2")
            .prop("checked", false)
   })

   root
      .find(".roll-siege-btn")
      .on("click", (e) => _handleRollClick(e, app, ctx))
}

async function _handleRollClick(e, app, ctx) {
   e.preventDefault()
   const btn = $(e.currentTarget)
   const btnType = btn.data("type")
   const {
      crewman,
      siege,
      isPortable,
      crewBlocked,
      shorthandedPenalty,
      autoDC,
   } = ctx

   if (btnType === "repair") {
      repairMacro(crewman, siege)
      return app.close()
   }
   if (btnType === "delegate-weight") {
      await delegateWeightMacro(crewman, siege)
      return app.close()
   }
   if (crewBlocked) {
      return ui.notifications.warn(tKey("Notifications.NotEnoughCrew"))
   }

   const actionItem = siege.items.get(btn.data("item"))
   if (!actionItem) return

   const flag = actionItem.getFlag(MODULE_ID, "siegeAction") || {}
   const detailsBody = btn.closest(".details-body")

   const rollContext = _readRollContext(detailsBody, flag)
   const customOptions = _buildCustomOptions(
      siege,
      flag,
      rollContext.versatileTrait,
   )

   const isLoading =
      actionItem.name === tKey("ActionTemplates.Load.Name") ||
      actionItem.name === "Loading"
   const isStrike = btnType === "strike"

   const distance = _calcDistance(siege, isStrike)
   if (isStrike && !_validateRange(distance, flag)) return

   const missingPrereqs = _findMissingPrereqs(siege, flag)
   if (missingPrereqs.length > 0) {
      return ui.notifications.warn(
         tKey("Notifications.MissingPrereqs", {
            name: actionItem.name,
            list: missingPrereqs.map((p) => p.name).join(", "),
         }),
      )
   }

   if ((flag.isAttack || flag.isStrike) && flag.usesAmmunition !== false) {
      if (!(await _deductAmmo(siege, flag))) return
   }

   const applyEffects = () => _applyEffects(siege, actionItem, flag)

   if (btnType === "skill") {
      const skillResult = await _handleSkillRoll(
         e,
         btn,
         actionItem,
         crewman,
         siege,
         flag,
         {
            autoDC,
            customOptions,
            shorthandedPenalty,
            applyEffects,
            app,
         },
      )
      if (!skillResult) return
   }

   if (btnType === "none") {
      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.PerformedAction", {
            crewman: crewman.name,
            action: actionItem.name,
            siege: siege.name,
         }),
      })
      await applyEffects()
      SiegeSFXManager.play(siege, `action-${actionItem.id}`)
   }

   if (isLoading) {
      await _handleLoadingFlow(actionItem, siege, crewman, flag)
      return app.close()
   }

   if (btnType === "ability-attack") {
      await _handleAbilityAttack(
         actionItem,
         siege,
         flag,
         detailsBody,
         applyEffects,
      )
      return app.close()
   }

   if (isStrike) {
      await _handleStrike(e, actionItem, siege, crewman, flag, {
         customOptions,
         rollContext,
         shorthandedPenalty,
         distance,
         isPortable,
         detailsBody,
         applyEffects,
         app,
      })
      return
   }

   app.close()
}

function _readRollContext(detailsBody, flag) {
   const rawTraits = splitCSV(flag.traits).map((t) => t.toLowerCase())
   const baseHasNonlethal = rawTraits.includes("nonlethal")

   const nonlethalCb = detailsBody.find(".siege-nonlethal-cb")
   const isNonlethalChecked = nonlethalCb.length
      ? nonlethalCb.is(":checked")
      : baseHasNonlethal

   const versatileRadio = detailsBody.find(".siege-versatile-radio:checked")
   const versatileTrait =
      versatileRadio.length && versatileRadio.val() !== "base"
         ? versatileRadio.val()
         : null
   const versatileType =
      versatileRadio.length && versatileRadio.val() !== "base"
         ? versatileRadio.data("type")
         : null

   return {
      baseHasNonlethal,
      isNonlethalChecked,
      versatileTrait,
      versatileType,
   }
}

function _buildCustomOptions(siege, flag, versatileTrait) {
   const options = splitCSV(flag.rollOptions)
   options.push(...ensureSiegeRoll(siege))
   splitCSV(flag.traits).forEach((t) => options.push(`trait:${t}`))
   if (versatileTrait) options.push(versatileTrait)
   return options
}

function _calcDistance(siege, isStrike) {
   if (!isStrike) return null
   const targets = Array.from(game.user.targets)
   if (targets.length === 0) return null
   const siegeToken = siege.getActiveTokens()[0]
   const targetToken = targets[0]
   if (!siegeToken || !targetToken) return null
   return siegeToken.distanceTo(targetToken)
}

function _validateRange(distance, flag) {
   if (flag.isRanged === false || distance === null) return true
   const blindRange = parseInt(flag.blindRange) || 0
   const maxRange = parseInt(flag.maxRange) || Infinity

   if (blindRange > 0 && distance <= blindRange) {
      ui.notifications.warn(
         tKey("Notifications.TooCloseBlindRange", { range: blindRange }),
      )
      return false
   }
   if (distance > maxRange) {
      ui.notifications.warn(
         tKey("Notifications.TooFarMaxRange", { range: maxRange }),
      )
      return false
   }
   return true
}

function _findMissingPrereqs(siege, flag) {
   const prereqs = flag.prerequisites || []
   return prereqs.filter((p) => {
      if (p.name === "Lifted") {
         return !siege.itemTypes.effect.some(
            (e) =>
               e.name === tKey("Markers.Lifted") &&
               e.getFlag(MODULE_ID, "isPortableMarker"),
         )
      }
      const usedName = tKey("Markers.ActionUsedSuffix", { name: p.name })
      const ef = siege.itemTypes.effect.find((ef) => ef.name === usedName)
      return !ef || (ef.system.badge?.value || 1) < p.count
   })
}

async function _deductAmmo(siege, flag) {
   const spendAmount = parseInt(flag.spend) || 1
   if (!flag.ammoSlug) return true

   const targetSlug = slugify(flag.ammoSlug)
   const ammoItem = siege.items.find(
      (i) => slugify(i.system?.slug || i.name) === targetSlug,
   )
   if (!ammoItem) {
      ui.notifications.warn(
         tKey("Notifications.MissingRequiredAmmo", { name: flag.ammoSlug }),
      )
      return false
   }

   const maxUses = ammoItem.system.charges?.max || 0
   const currentUses = ammoItem.system.charges?.value || 0
   const qty = ammoItem.system.quantity || 1
   const totalAvailable = maxUses > 0 ? (qty - 1) * maxUses + currentUses : qty

   if (totalAvailable < spendAmount) {
      ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
      return false
   }

   const newTotal = totalAvailable - spendAmount
   if (newTotal <= 0) {
      await SiegeSocketManager.modifySiegeItem(siege.uuid, "delete", [
         ammoItem.id,
      ])
      return true
   }

   if (maxUses > 0) {
      const newQty = Math.ceil(newTotal / maxUses)
      const newUses = newTotal % maxUses === 0 ? maxUses : newTotal % maxUses
      await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", [
         {
            _id: ammoItem.id,
            "system.quantity": newQty,
            "system.charges.value": newUses,
         },
      ])
   } else {
      await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", [
         { _id: ammoItem.id, "system.quantity": newTotal },
      ])
   }
   return true
}

async function _applyEffects(siege, actionItem, flag) {
   const prereqs = flag.prerequisites || []
   const prereqNames = new Set(prereqs.map((p) => p.name))

   if (flag.removePrereqsOnUse !== false) {
      const usedSuffix = tKey("Markers.ActionUsedSuffix", {
         name: "@@@",
      }).replace("@@@", "")
      const toDelete = siege.itemTypes.effect.filter((ef) => {
         if (ef.name.startsWith(tKey("Markers.LoadedPrefix", { name: "" })))
            return false
         const base = ef.name.includes(usedSuffix)
            ? ef.name.replace(usedSuffix, "")
            : ef.name
         return prereqNames.has(base) || prereqNames.has(ef.name)
      })
      if (toDelete.length > 0) {
         await SiegeSocketManager.modifySiegeItem(
            siege.uuid,
            "delete",
            toDelete.map((ef) => ef.id),
         )
      }
   }

   const loadName = tKey("ActionTemplates.Load.Name")
   const isRequired =
      actionItem.name === loadName ||
      actionItem.name === "Loading" ||
      siege.items.some(
         (i) =>
            i.type === "action" &&
            (i.getFlag(MODULE_ID, "siegeAction")?.prerequisites || []).some(
               (p) => p.name === actionItem.name,
            ),
      )
   if (!isRequired) return

   const effectName = tKey("Markers.ActionUsedSuffix", {
      name: actionItem.name,
   })
   const existing = siege.itemTypes.effect.find((ef) => ef.name === effectName)

   if (existing) {
      await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", [
         {
            _id: existing.id,
            "system.badge.value": (existing.system.badge?.value || 1) + 1,
         },
      ])
      return
   }

   const durationObj = flag.unlimitedDuration
      ? { value: "unlimited", unit: "unlimited", expiry: null }
      : {
           value: flag.effectDuration || 1,
           unit: "rounds",
           expiry: flag.effectExpiry || "turn-start",
        }

   await SiegeSocketManager.modifySiegeItem(siege.uuid, "create", [
      {
         name: effectName,
         type: "effect",
         img: actionItem.img,
         system: {
            level: { value: 1 },
            duration: durationObj,
            badge: { type: "counter", value: 1 },
            description: {
               value: tKey("Markers.ActionUsedDesc", { name: actionItem.name }),
            },
            tokenIcon: { show: true },
         },
         flags: { [MODULE_ID]: { isSiegeMarker: true } },
      },
   ])
}

async function _handleSkillRoll(e, btn, actionItem, crewman, siege, flag, ctx) {
   const { autoDC, customOptions, shorthandedPenalty, applyEffects, app } = ctx
   const sData = flag.skills[btn.data("skillidx")]
   const targetDC = sData.dc === "" || sData.dc === null ? autoDC : sData.dc

   const rollModifiers = []
   if (shorthandedPenalty < 0) {
      const m = makeModifier(
         "shorthanded-penalty",
         tKey("Modifiers.Shorthanded"),
         shorthandedPenalty,
         "circumstance",
      )
      if (m) rollModifiers.push(m)
   }

   let rollOutcome = "success"
   let rollCompleted = false

   const rollArgs = {
      event: e.originalEvent ?? e,
      extraRollOptions: customOptions,
      modifiers: rollModifiers,
      dc: { value: targetDC },
      callback: (_roll, outcome) => {
         rollOutcome = outcome
         rollCompleted = true
      },
   }

   if (sData.name === "lore") {
      const loreSkill = Object.values(crewman.skills).find(
         (sk) => sk.slug === sData.loreName,
      )
      if (!loreSkill) {
         ui.notifications.warn(
            tKey("Notifications.LoreNotFound", { name: sData.loreName }),
         )
         app.close()
         return false
      }
      await loreSkill.roll(rollArgs)
   } else if (sData.name === "perception" && crewman.perception) {
      await crewman.perception.roll(rollArgs)
   } else if (crewman.skills[sData.name]) {
      await crewman.skills[sData.name].roll(rollArgs)
   } else {
      ui.notifications.warn(
         tKey("Notifications.SkillNotFound", { name: sData.name }),
      )
      app.close()
      return false
   }

   if (!rollCompleted) {
      app.close()
      return false
   }
   if (rollOutcome === "failure" || rollOutcome === "criticalFailure") {
      ui.notifications.warn(
         tKey("Notifications.ActionFailed", { name: actionItem.name }),
      )
      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.ActionFailed", {
            crewman: crewman.name,
            action: actionItem.name,
            siege: siege.name,
         }),
      })
      app.close()
      return false
   }

   await applyEffects()
   return true
}

async function _handleLoadingFlow(actionItem, siege, crewman, flag) {
   const targetThreshold = flag.loadThreshold || 1
   const usedName = tKey("Markers.ActionUsedSuffix", { name: actionItem.name })
   const loadEf = siege.itemTypes.effect.find((ef) => ef.name === usedName)
   const currentLoadCount = loadEf ? loadEf.system.badge?.value || 1 : 0

   if (currentLoadCount < targetThreshold) {
      return ui.notifications.info(
         tKey("Load.ProgressInfo", {
            name: actionItem.name,
            current: currentLoadCount,
            target: targetThreshold,
         }),
      )
   }

   const ammoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || []
   if (ammoTypes.length === 0)
      return ui.notifications.warn(tKey("Notifications.NoAmmoTypesDefined"))

   const optionsList = ammoTypes
      .map((t) => {
         const tSlug = slugify(t.slug || t.name)
         const currentQty = AmmunitionManager.getCurrentAmmoCount(siege, tSlug)
         const max =
            t.max === "" || t.max == null ? tKey("Misc.Infinity") : t.max
         return `<option value="${tSlug}" data-loaded="${currentQty}" data-max="${max}">${t.name}</option>`
      })
      .join("")

   const dialogContent = `
      <div class="form-group">
         <label>${tKey("Load.Ammunition")}</label>
         <select id="load-ammo-slug">${optionsList}</select>
      </div>
      <div class="form-group">
         <label>${tKey("Load.Amount")}</label>
         <input type="number" id="load-ammo-qty" value="1" min="1">
      </div>
      <p id="load-ammo-tracker" class="notes siege-load-tracker">${tKey(
         "Load.Tracker",
         { current: 0, max: tKey("Misc.Infinity") },
      )}</p>`

   const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: tKey("Load.DialogTitle", { name: siege.name }) },
      position: { width: 450 },
      content: dialogContent,
      buttons: [
         {
            action: "load",
            label: tKey("Load.LoadButton"),
            icon: "fa-solid fa-truck-loading",
            callback: () => ({
               slug: document.getElementById("load-ammo-slug").value,
               qty:
                  parseInt(document.getElementById("load-ammo-qty").value) || 1,
            }),
         },
      ],
      render: _bindLoadDialog,
   })

   if (!choice) return
   await _performLoad(choice, siege, crewman, actionItem, flag, ammoTypes)
}

function _bindLoadDialog() {
   const select = document.getElementById("load-ammo-slug")
   const tracker = document.getElementById("load-ammo-tracker")
   if (!select || !tracker) return
   const updateTracker = () => {
      const opt = select.options[select.selectedIndex]
      if (opt)
         tracker.innerText = tKey("Load.Tracker", {
            current: opt.dataset.loaded,
            max: opt.dataset.max,
         })
   }
   select.addEventListener("change", updateTracker)
   updateTracker()
}

async function _performLoad(
   choice,
   siege,
   crewman,
   actionItem,
   flag,
   ammoTypes,
) {
   const tInfo = ammoTypes.find(
      (t) => slugify(t.slug || t.name) === choice.slug,
   )
   const maxCap =
      tInfo.max === "" || tInfo.max == null ? Infinity : parseInt(tInfo.max)
   const currentQty = AmmunitionManager.getCurrentAmmoCount(siege, choice.slug)
   const availableSpace = maxCap - currentQty

   if (availableSpace <= 0) {
      return ui.notifications.warn(
         tKey("Notifications.MaxCapacityReachedGeneric"),
      )
   }

   const requestedQty = parseInt(choice.qty) || 1
   const actualLoadQty = Math.min(requestedQty, availableSpace)
   let ammoProcured = 0
   const extracts = []

   if (flag.takeAmmoFromAdjacent) {
      const siegeToken = siege.getActiveTokens()[0]
      if (!siegeToken) {
         return ui.notifications.warn(tKey("Notifications.SiegeTokenNotFound"))
      }

      const validTypes = ["loot", "npc", "vehicle", "character"]
      const adjacentTokens = canvas.tokens.placeables
         .filter(
            (t) =>
               t.actor &&
               validTypes.includes(t.actor.type) &&
               siegeToken.distanceTo(t) <= 5 &&
               t.id !== siegeToken.id,
         )
         .sort(
            (a, b) =>
               validTypes.indexOf(a.actor.type) -
               validTypes.indexOf(b.actor.type),
         )

      for (const t of adjacentTokens) {
         if (ammoProcured >= actualLoadQty) break
         const ammoItem = t.actor.items.find(
            (i) =>
               AmmunitionManager.isAmmoItem(i) &&
               (i.system?.slug || slugify(i.name)) === choice.slug,
         )
         if (ammoItem) {
            const qtyAvailable = ammoItem.system.quantity
            if (qtyAvailable > 0) {
               const take = Math.min(qtyAvailable, actualLoadQty - ammoProcured)
               extracts.push({ uuid: ammoItem.uuid, take })
               ammoProcured += take
            }
         }
      }
      if (ammoProcured === 0) {
         return ui.notifications.warn(tKey("Notifications.NoAdjacentAmmo"))
      }
   } else {
      ammoProcured = actualLoadQty
   }

   await SiegeSocketManager.executeLoad(
      siege.uuid,
      choice,
      extracts,
      crewman.uuid,
      ammoProcured,
      flag.takeAmmoFromAdjacent,
   )

   const usedName = tKey("Markers.ActionUsedSuffix", { name: actionItem.name })
   const loadEffects = siege.itemTypes.effect.filter(
      (ef) => ef.name === usedName,
   )
   if (loadEffects.length > 0) {
      await SiegeSocketManager.modifySiegeItem(
         siege.uuid,
         "delete",
         loadEffects.map((ef) => ef.id),
      )
   }
}

async function _handleAbilityAttack(
   actionItem,
   siege,
   flag,
   detailsBody,
   applyEffects,
) {
   const isAreaOrSave =
      flag.actionType === "area-fire" ||
      flag.actionType === "auto-fire" ||
      flag.actionType === "save-single"

   if (!isAreaOrSave) {
      await actionItem.toMessage(undefined, {
         speaker: ChatMessage.getSpeaker({ actor: siege }),
      })
      await applyEffects()
      return
   }

   const damageParts = flag.damageParts || []
   const damageFormula = damageParts
      .map((p) => {
         const faces = p.die === "-" ? "" : p.die
         const base = `${p.dice}${faces}`
         const tags = [p.type]
         if (p.category && p.category !== "normal") tags.push(p.category)
         return `${base}[${tags.join(",")}]`
      })
      .join(",")

   let finalAreaType = flag.areaType
   let finalAreaSize = flag.areaSize

   if (detailsBody.find(".siege-corner-shot-cb").is(":checked")) {
      if (flag.areaType === "burst") {
         finalAreaType = "line"
         finalAreaSize = flag.areaSize * 2
      } else if (flag.areaType === "line") {
         finalAreaType = "burst"
         finalAreaSize = Math.max(5, flag.areaSize / 2)
      }
   }

   const inlineTemplate =
      flag.actionType === "save-single"
         ? ""
         : `@Template[type:${finalAreaType}|distance:${finalAreaSize}]`
   const inlineSave = `@Check[type:reflex|dc:${flag.saveDC}|traits:${flag.actionType}|showDC:all]`
   const inlineDamage = `@Damage[${damageFormula}]`

   const ephemeralData = actionItem.toObject()
   if (!ephemeralData.system.traits) ephemeralData.system.traits = { value: [] }
   if (
      Array.isArray(ephemeralData.system.traits.value) &&
      !ephemeralData.system.traits.value.includes("siege-weapon")
   ) {
      ephemeralData.system.traits.value.push("siege-weapon")
   }
   ephemeralData.system.description.value += `<hr><p class="siege-ability-template">${inlineTemplate}</p><p>${inlineSave}</p><p>${inlineDamage}</p>`

   const tempAttack = new Item.implementation(ephemeralData, { parent: siege })
   const siegeTokenDoc = siege.getActiveTokens()[0]?.document
   const hookId = Hooks.once("preCreateChatMessage", (msg) => {
      msg.updateSource({
         "speaker.alias": siege.name,
         "speaker.token": siegeTokenDoc?.id || null,
      })
   })

   try {
      await tempAttack.toMessage(undefined, {
         speaker: ChatMessage.getSpeaker({ actor: siege }),
      })
      await applyEffects()
   } finally {
      Hooks.off("preCreateChatMessage", hookId)
   }
}

async function _handleStrike(e, actionItem, siege, crewman, flag, ctx) {
   const {
      customOptions,
      rollContext,
      shorthandedPenalty,
      distance,
      isPortable,
      detailsBody,
      applyEffects,
      app,
   } = ctx
   const strikeLabel = actionItem.name

   let generatedStrike = crewman.system.actions?.find(
      (act) => act.type === "strike" && act.label === strikeLabel,
   )
   if (!generatedStrike) {
      ui.notifications.warn(tKey("Notifications.StrikeNotFoundRemount"))
      return app.close()
   }

   const highestStr = _calcHighestStr(isPortable, detailsBody, siege)
   const reload = await _maybeUpdateStrikeRules(
      crewman,
      siege,
      strikeLabel,
      rollContext.versatileType,
      flag,
      highestStr,
   )
   if (reload === "missing") {
      ui.notifications.warn(tKey("Notifications.FailedReloadStrike"))
      return app.close()
   }
   if (reload) generatedStrike = reload

   const weaponMod = generatedStrike.totalModifier
   const { bestMod, bestSkillName } = computeBestModifier(
      crewman,
      flag,
      weaponMod,
   )
   const modDiff = bestMod - weaponMod

   const choice = await _showStrikeOptionsDialog(actionItem, flag)
   if (!choice) return

   const modifiers = _buildStrikeModifiers(choice, {
      modDiff,
      bestSkillName,
      shorthandedPenalty,
      flag,
      distance,
      rollContext,
   })

   const siegeTokenId = getSiegeTokenId(siege)
   let rolling = true

   const hookId = Hooks.on("preCreateChatMessage", (msg) => {
      if (!rolling) return
      const type = msg.flags?.pf2e?.context?.type
      if (type !== "attack-roll") return
      _updateAttackMessage(msg, {
         siege,
         siegeTokenId,
         actionItem,
         flag,
         strikeLabel,
         crewman,
         rollContext,
      })
   })

   try {
      await generatedStrike.variants[choice.mapIndex].roll({
         event: e.originalEvent ?? e,
         modifiers,
         options: customOptions,
      })
   } finally {
      rolling = false
      Hooks.off("preCreateChatMessage", hookId)
   }

   await applyEffects()
   SiegeSFXManager.play(siege, `action-${actionItem.id}`)
   app.close()
}

function _calcHighestStr(isPortable, detailsBody, siege) {
   if (!isPortable || !detailsBody.find(".siege-highest-str-cb").is(":checked"))
      return 0
   let highestStr = 0
   for (const actor of game.actors) {
      if (
         actor.itemTypes.effect.some(
            (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
         )
      ) {
         const strMod = actor.system.abilities?.str?.mod || 0
         if (strMod > highestStr) highestStr = strMod
      }
   }
   return highestStr
}

async function _maybeUpdateStrikeRules(
   crewman,
   siege,
   strikeLabel,
   versatileType,
   flag,
   highestStr,
) {
   const mountedEffect = crewman.itemTypes.effect.find(
      (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
   )
   if (!mountedEffect) return null

   const newRules = foundry.utils.deepClone(mountedEffect.system.rules)
   const strikeRule = newRules.find(
      (r) => r.key === "Strike" && r.label === strikeLabel,
   )
   let rulesChanged = false

   if (strikeRule) {
      const targetDamageType =
         versatileType || flag.damageParts?.[0]?.type || "bludgeoning"
      if (strikeRule.damage.base.damageType !== targetDamageType) {
         strikeRule.damage.base.damageType = targetDamageType
         rulesChanged = true
      }
   }

   const existingStrIdx = newRules.findIndex(
      (r) => r.slug === "siege-str-damage",
   )
   if (highestStr > 0) {
      if (existingStrIdx >= 0) newRules.splice(existingStrIdx, 1)
      newRules.push({
         key: "FlatModifier",
         slug: "siege-str-damage",
         selector: "strike-damage",
         predicate: [`siege-weapon:${slugify(siege.name)}`],
         value: highestStr,
         type: "untyped",
         label: tKey("Modifiers.CrewStrengthBonus"),
      })
      rulesChanged = true
   } else if (existingStrIdx >= 0) {
      newRules.splice(existingStrIdx, 1)
      rulesChanged = true
   }

   if (!rulesChanged) return null

   await mountedEffect.update({ "system.rules": newRules })
   const updated = crewman.system.actions?.find(
      (act) => act.type === "strike" && act.label === strikeLabel,
   )
   return updated || "missing"
}

async function _showStrikeOptionsDialog(actionItem, flag) {
   const mapHtml = flag.subjectToMAP
      ? `<div class="form-group siege-form-group"><label><strong>${tKey("ActionMacro.AttackTier")}</strong></label><select id="siege-map-val"><option value="0">${tKey("ActionMacro.MAP1")}</option><option value="1">${tKey("ActionMacro.MAP2")}</option><option value="2">${tKey("ActionMacro.MAP3")}</option></select></div>`
      : `<input type="hidden" id="siege-map-val" value="0">`

   return foundry.applications.api.DialogV2.wait({
      window: {
         title: tKey("ActionMacro.RollOptionsTitle", { name: actionItem.name }),
      },
      content: `${mapHtml}<div class="form-group siege-form-group"><label><strong>${tKey("ActionMacro.SituationalModifier")}</strong></label><input type="number" id="siege-sit-mod" value="0"></div>`,
      buttons: [
         {
            action: "roll",
            label: tKey("ActionMacro.RollAttack"),
            icon: "fa-solid fa-dice-d20",
            callback: () => ({
               mapIndex:
                  parseInt(document.getElementById("siege-map-val")?.value) ||
                  0,
               sit:
                  parseInt(document.getElementById("siege-sit-mod")?.value) ||
                  0,
            }),
         },
      ],
   })
}

function _buildStrikeModifiers(choice, ctx) {
   const {
      modDiff,
      bestSkillName,
      shorthandedPenalty,
      flag,
      distance,
      rollContext,
   } = ctx
   const modifiers = []

   if (choice.sit !== 0) {
      const m = makeModifier(
         "situational",
         tKey("Modifiers.Situational"),
         choice.sit,
         "untyped",
      )
      if (m) modifiers.push(m)
   }

   if (rollContext.baseHasNonlethal && !rollContext.isNonlethalChecked) {
      const m = makeModifier(
         "lethal-penalty",
         tKey("Modifiers.LethalPenalty"),
         -2,
         "circumstance",
      )
      if (m) modifiers.push(m)
   }

   if (modDiff > 0) {
      const m = makeModifier(
         "skill-substitution",
         tKey("Modifiers.SkillBonus", { name: bestSkillName }),
         modDiff,
         "untyped",
      )
      if (m) modifiers.push(m)
   }

   if (shorthandedPenalty < 0) {
      const m = makeModifier(
         "shorthanded-penalty",
         tKey("Modifiers.Shorthanded"),
         shorthandedPenalty,
         "circumstance",
      )
      if (m) modifiers.push(m)
   }

   const rangeIncrement = parseInt(flag.rangeIncrement) || 0
   if (
      flag.isRanged !== false &&
      distance !== null &&
      rangeIncrement > 0 &&
      distance > rangeIncrement
   ) {
      const extraIncrements = Math.ceil(distance / rangeIncrement) - 1
      if (extraIncrements > 0) {
         const m = makeModifier(
            "range-penalty",
            tKey("Modifiers.RangePenalty"),
            -2 * extraIncrements,
            "untyped",
         )
         if (m) modifiers.push(m)
      }
   }

   const minRange = parseInt(flag.minRange) || 0
   if (
      flag.isRanged !== false &&
      distance !== null &&
      minRange > 0 &&
      distance <= minRange
   ) {
      const m = makeModifier(
         "volley",
         tKey("Modifiers.Volley"),
         -2,
         "circumstance",
      )
      if (m) modifiers.push(m)
   }

   return modifiers
}

function _updateAttackMessage(msg, ctx) {
   const {
      siege,
      siegeTokenId,
      actionItem,
      flag,
      strikeLabel,
      crewman,
      rollContext,
   } = ctx
   const currentTraits = msg.flags?.pf2e?.context?.traits || []
   let newTraits = [...currentTraits]

   if (!newTraits.some((t) => t.name === "siege-weapon")) {
      newTraits.push({
         name: "siege-weapon",
         label: tKey("Traits.SiegeWeapon"),
      })
   }

   for (const t of splitCSV(flag.traits)) {
      if (!newTraits.some((existing) => existing.name === t)) {
         newTraits.push({ name: t, label: capitalize(t) })
      }
   }

   if (rollContext.baseHasNonlethal && !rollContext.isNonlethalChecked) {
      newTraits = newTraits.filter((t) => t.name !== "nonlethal")
   }

   const updates = {
      "speaker.alias": siege.name,
      "speaker.token": siegeTokenId,
      "flags.pf2e.origin.uuid": actionItem.uuid,
      "flags.pf2e.origin.type": actionItem.type,
      "flags.pf2e.context.traits": newTraits,
      [`flags.${MODULE_ID}.crewmanId`]: crewman.id,
      [`flags.${MODULE_ID}.strikeLabel`]: strikeLabel,
      [`flags.${MODULE_ID}.siegeId`]: siege.id,
      [`flags.${MODULE_ID}.siegeTokenId`]: siegeTokenId,
   }

   if (
      rollContext.versatileType &&
      msg.flags?.pf2e?.strike?.item?.system?.damage
   ) {
      updates["flags.pf2e.strike.item.system.damage.damageType"] =
         rollContext.versatileType
   }

   msg.updateSource(updates)
}
