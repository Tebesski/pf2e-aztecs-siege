import { MODULE_ID } from "../constants.mjs"
import {
   slugify,
   splitCSV,
   capitalize,
   tKey,
   ensureSiegeRoll,
   makeModifier,
   getSiegeTokenId,
   getCrewActors,
   buildStrikeRules,
} from "../utils.mjs"
import { computeBestModifier, resolveActionDC, resolveSaveDC } from "./helpers.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"
import { SiegeSettings } from "../managers/settings.mjs"
import { ammoTypesAccordionHTML } from "../ui/ammo-details.mjs"

const AMMO_SOURCE_PRIORITY = ["loot", "npc", "familiar", "character", "vehicle"]

function _isEligibleAmmoSource(actor) {
   if (!actor) return false
   const type = actor.type?.toLowerCase()
   if (type === "hazard") return false
   return AMMO_SOURCE_PRIORITY.includes(type)
}

function _ammoSourceRank(actor, siege = null) {
   if (siege && actor?.id === siege.id) return 0
   const idx = AMMO_SOURCE_PRIORITY.indexOf(actor?.type?.toLowerCase())
   return idx === -1 ? Number.MAX_SAFE_INTEGER : idx + 1
}

function _tokenRect(token) {
   const grid = canvas?.grid?.size || canvas?.dimensions?.size || 100
   const doc = token.document ?? token
   const x = doc.x ?? token.x ?? 0
   const y = doc.y ?? token.y ?? 0
   const w = (doc.width ?? 1) * grid
   const h = (doc.height ?? 1) * grid
   return { left: x, top: y, right: x + w, bottom: y + h }
}

function _tokensAdjacent(a, b) {
   if (!a || !b) return false
   const grid = canvas?.grid?.size || canvas?.dimensions?.size || 100
   const ra = _tokenRect(a)
   const rb = _tokenRect(b)
   const gapX = Math.max(0, rb.left - ra.right, ra.left - rb.right)
   const gapY = Math.max(0, rb.top - ra.bottom, ra.top - rb.bottom)
   const tol = grid * 0.34
   return gapX <= tol && gapY <= tol
}

function _firstToken(actor) {
   return actor?.getActiveTokens?.()[0] || null
}




function collectAdjacentAmmoSources(siege, crewman) {
   const siegeToken = _firstToken(siege)
   if (!siegeToken) return { abort: true, reason: "no-siege-token", sources: [] }

   const crewToken = _firstToken(crewman)
   if (!crewToken)
      return { abort: true, reason: "no-crewman-token", sources: [] }

   if (!_tokensAdjacent(siegeToken, crewToken))
      return { abort: true, reason: "crewman-not-adjacent", sources: [] }

   const sources = [siege, crewman]
   for (const t of canvas.tokens.placeables) {
      if (!t.actor || t.id === siegeToken.id) continue
      if (t.actor === crewman || t.actor.id === crewman.id) continue
      if (!_isEligibleAmmoSource(t.actor)) continue
      if (_tokensAdjacent(siegeToken, t) && _tokensAdjacent(crewToken, t))
         sources.push(t.actor)
   }

   const ordered = [...new Set(sources)].sort(
      (a, b) => _ammoSourceRank(a, siege) - _ammoSourceRank(b, siege),
   )
   return { abort: false, sources: ordered }
}

export function readRollContext(detailsBody, flag) {
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
   const vehiclePenalty = parseInt(detailsBody.find(".veh-penalty-select").val()) || 0

   return {
      baseHasNonlethal,
      isNonlethalChecked,
      versatileTrait,
      versatileType,
      vehiclePenalty,
   }
}

export function buildCustomOptions(siege, flag, versatileTrait) {
   const options = splitCSV(flag.rollOptions)
   options.push(...ensureSiegeRoll(siege))
   splitCSV(flag.traits).forEach((t) => options.push(`trait:${t}`))
   if (versatileTrait) options.push(versatileTrait)
   if (flag.isRanged !== false) options.push("ignore-range-penalty")
   return options
}

export function calcDistance(siege, isStrike) {
   if (!isStrike) return null
   const targets = Array.from(game.user.targets)
   if (targets.length === 0) return null
   const siegeToken = siege.getActiveTokens()[0]
   const targetToken = targets[0]
   if (!siegeToken || !targetToken) return null
   const gridSize = canvas?.grid?.size || canvas?.dimensions?.size || 100
   const gridDistance =
      Number(canvas?.scene?.grid?.distance) ||
      Number(canvas?.grid?.distance) ||
      5
   const centerOf = (token) => {
      const doc = token.document ?? token
      const width = (doc.width ?? token.w ?? 1) * gridSize
      const height = (doc.height ?? token.h ?? 1) * gridSize
      return {
         x: (doc.x ?? token.x ?? 0) + width / 2,
         y: (doc.y ?? token.y ?? 0) + height / 2,
      }
   }
   const a = centerOf(siegeToken)
   const b = centerOf(targetToken)
   return (Math.hypot(a.x - b.x, a.y - b.y) / gridSize) * gridDistance
}

export function validateRange(distance, flag) {
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

export function findMissingPrereqs(siege, flag) {
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

export async function deductAmmo(siege, flag, action = null, options = {}) {
   if (flag.usesAmmunition === false) return true
   const acceptedSlugs = AmmunitionManager.ammoSlugsForAction(flag)
   if (acceptedSlugs.length === 0) {
      ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
      return false
   }
   if (!acceptedSlugs.some((slug) => AmmunitionManager.ammoTypeFor(siege, slug))) {
      ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
      return false
   }

   const spendAmount = parseInt(flag.spend) || 1

   if (action) {
      if (!options.forceLocal && !game.user.isGM && globalThis.siegeSocket) {
         return SiegeSocketManager.deductAmmo(siege, action, flag)
      }
      const loaded = AmmunitionManager.getStrikeLoaded(siege, action)
      const templates = siege.getFlag(MODULE_ID, "loadedAmmoTemplates") || {}
      const tpl = templates[action.id]
      const tplCharge = AmmunitionManager._chargeInfo(tpl)
      const loadedPieces = AmmunitionManager.getLoadedAmmoPieces(siege, action)
      if (loadedPieces.length > 0) {
         const activeId = AmmunitionManager.getActiveLoadedPieceId(siege, action)
         const activeIndex = loadedPieces.findIndex(
            (piece) => piece.id === activeId,
         )
         const index = activeIndex >= 0 ? activeIndex : 0
         const active = loadedPieces[index]
         console.debug("[siege][ammo] deduct active loaded piece", {
            siege: siege.name,
            action: action.name,
            spendAmount,
            active,
            pieces: loadedPieces.map((piece) => ({
               id: piece.id,
               slug: piece.slug,
               charges: piece.charges,
               max: piece.max,
               usesCharges: piece.usesCharges,
            })),
         })
         if (!active) {
            ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
            return false
         }

         let remainingPieces
         let nextActiveId = active.id
         if (active.usesCharges) {
            if (active.charges < spendAmount) {
               ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
               return false
            }
            active.charges -= spendAmount
            remainingPieces = loadedPieces.filter((piece) => piece.charges > 0)
            nextActiveId = active.charges > 0 ? active.id : remainingPieces[0]?.id
         } else {
            const ordered = [
               active,
               ...loadedPieces.filter(
                  (piece) => piece.id !== active.id && piece.slug === active.slug,
               ),
               ...loadedPieces.filter(
                  (piece) => piece.id !== active.id && piece.slug !== active.slug,
               ),
            ]
            if (ordered.length < spendAmount) {
               ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
               return false
            }
            const spent = new Set(ordered.slice(0, spendAmount).map((piece) => piece.id))
            remainingPieces = loadedPieces.filter((piece) => !spent.has(piece.id))
            nextActiveId = remainingPieces[0]?.id
         }
         await AmmunitionManager.setLoadedAmmoPieces(
            siege,
            action.id,
            remainingPieces,
            nextActiveId,
         )
         return true
      }
      let loadedCharges = AmmunitionManager.getStrikeLoadedCharges(siege, action)
      if (tplCharge.usesCharges && loadedCharges.length === 0 && loaded > 0) {
         loadedCharges = Array.from({ length: loaded }, () => tplCharge.max)
      }

      if (loadedCharges.length > 0) {
         const enoughSingle = loadedCharges.findIndex((n) => n >= spendAmount)
         if (enoughSingle >= 0) {
            loadedCharges[enoughSingle] -= spendAmount
         } else {
            const totalCharges = loadedCharges.reduce((sum, n) => sum + n, 0)
            if (totalCharges < spendAmount) {
               ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
               return false
            }
            let remaining = spendAmount
            for (let i = 0; i < loadedCharges.length && remaining > 0; i++) {
               const take = Math.min(loadedCharges[i], remaining)
               loadedCharges[i] -= take
               remaining -= take
            }
         }
         loadedCharges = loadedCharges.filter((n) => n > 0)
         await AmmunitionManager.setStrikeLoadedCharges(
            siege,
            action.id,
            loadedCharges,
         )
         await AmmunitionManager.setStrikeLoaded(
            siege,
            action.id,
            loadedCharges.length,
         )
         return true
      }

      if (loaded < spendAmount) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }
      await AmmunitionManager.setStrikeLoaded(
         siege,
         action.id,
         loaded - spendAmount,
      )
      return true
   }

   const targetSlug = acceptedSlugs[0]
   const ammoItem = siege.items.find(
      (i) => slugify(i.system?.slug || i.name) === targetSlug,
   )
   if (!ammoItem) {
      ui.notifications.warn(
         tKey("Notifications.MissingRequiredAmmo", { name: targetSlug }),
      )
      return false
   }
   const charge = AmmunitionManager._chargeInfo(ammoItem)
   const maxUses = charge.max
   const currentUses = charge.value
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
            [charge.path]: newUses,
         },
      ])
   } else {
      await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", [
         { _id: ammoItem.id, "system.quantity": newTotal },
      ])
   }
   return true
}

export async function applyActionEffects(siege, actionItem, flag) {
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

export async function handleSkillRoll(
   e,
   btn,
   actionItem,
   crewman,
   siege,
   flag,
   ctx,
) {
   const { autoDC, customOptions, shorthandedPenalty, applyEffects, app } = ctx
   const sData = flag.skills[btn.data("skillidx")]
   const targetDC = resolveActionDC(crewman, sData.dc, autoDC)

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
      
      
      const wanted = sData.loreName || ""
      const wantedBase = wanted.replace(/-lore$/i, "")
      const loreSkill = Object.values(crewman.skills).find((sk) => {
         const slug = sk.slug || ""
         const slugBase = slug.replace(/-lore$/i, "")
         return slug === wanted || slugBase === wantedBase
      })
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

export async function handleLoadingFlow(
   actionItem,
   siege,
   crewman,
   flag,
   applyEffects,
   options = {},
) {
   const usedName = tKey("Markers.ActionUsedSuffix", { name: actionItem.name })
   const loadableStrikes = await _loadableStrikes(siege, crewman)
   if (loadableStrikes.length === 0) {
      ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
      return false
   }

   const optionsList = loadableStrikes
      .map(
         (s) => {
            return `<option value="${s.id}" data-loaded="${s.loaded}" data-max="${s.max}" data-cap="${s.cap}" data-ammo="${s.ammoName}" data-replacing="${s.replacingCharged ? "1" : "0"}" ${s.id === options.preselectedActionId ? "selected" : ""}>${s.name}</option>`
         },
      )
      .join("")
   const ammoTypePanels = loadableStrikes
      .map(
         (s) => `<div class="siege-load-ammo-types-panel" data-action-id="${s.id}" style="display: none;">
            <details class="vh-ammo-outer-acc siege-action-ammo-types">
               <summary>
                  <span><i class="fa-solid fa-bomb"></i> ${tKey("Weaponry.AmmunitionTypes")}</span>
                  <i class="fa-solid fa-chevron-right chevron"></i>
               </summary>
               <div class="details-body">${s.ammoTypesHtml}</div>
            </details>
         </div>`,
      )
      .join("")

   const dialogContent = `
      <div class="form-group">
         <label>${tKey("Load.Strike")}</label>
         <select id="load-strike-id">${optionsList}</select>
      </div>
      <div class="form-group">
         <label>${tKey("Load.Amount")}</label>
         <input type="number" id="load-ammo-qty" value="1" min="1">
      </div>
      <p id="load-ammo-tracker" class="notes siege-load-tracker">${tKey(
         "Load.Tracker",
         { current: 0, max: tKey("Misc.Infinity") },
      )}</p>
      <div id="load-ammo-types-container">${ammoTypePanels}</div>`

   const choice = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("Load.DialogTitle", { name: siege.name }) },
      position: { width: 450 },
      content: dialogContent,
      buttons: [
         {
            action: "load",
            label: tKey("Load.LoadButton"),
            icon: "fa-solid fa-truck-loading",
            callback: () => ({
               actionId: document.getElementById("load-strike-id").value,
               qty: parseInt(document.getElementById("load-ammo-qty").value) || 1,
            }),
         },
      ],
      render: _bindStrikeLoadDialog,
   })

   if (!choice) return false

   const strike = siege.items.get(choice.actionId)
   if (!strike) return false
   const strikeData = loadableStrikes.find((s) => s.id === choice.actionId)
   const qty = Math.max(
      1,
      Math.min(strikeData?.cap || 1, parseInt(choice.qty) || 1),
   )
   const loadSuccess = await SiegeSocketManager.reloadStrike(siege, strike, qty, {
      crewmanUuid: crewman?.uuid,
      useAdjacent: true,
      sourceContext: "load-macro",
   })
   if (loadSuccess) {
      await applyEffects()
      const finalLoadEffects = siege.itemTypes.effect.filter(
         (ef) => ef.name === usedName,
      )
      if (finalLoadEffects.length > 0) {
         await SiegeSocketManager.modifySiegeItem(
            siege.uuid,
            "delete",
            finalLoadEffects.map((ef) => ef.id),
         )
      }
   }
   return loadSuccess
}

async function _loadableStrikes(siege, crewman = null) {
   const rows = []
   const sources = await AmmunitionManager.collectLoadSources(siege, crewman, {
      includeAdjacent: true,
   })
   for (const action of siege.items.filter((i) => i.type === "action")) {
      const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
      if (!(flag.isStrike || flag.isAttack)) continue
      if (flag.usesAmmunition === false) continue
      const ammoChoices = AmmunitionManager.ammoTypesForAction(siege, flag)
      if (ammoChoices.length === 0) continue
      const max = AmmunitionManager.strikeMaxLoaded(action)
      const loaded = AmmunitionManager.getStrikeLoaded(siege, action)
      const replacingCharged =
         AmmunitionManager.reloadNeedsChargedReplacement(siege, action)
      const loadedSlugs = new Set(
         AmmunitionManager.getLoadedAmmoPieces(siege, action)
            .map((piece) => slugify(piece.slug || piece.name))
            .filter(Boolean),
      )
      if (loaded > 0 && loadedSlugs.size === 0) {
         const activeSlug = AmmunitionManager.activeAmmoSlug(siege, action)
         if (activeSlug) loadedSlugs.add(slugify(activeSlug))
      }
      const availableChoices = ammoChoices
         .map(({ slug, type }) => {
            const available = AmmunitionManager.getAvailableLoadUnitsFromSources(
               siege,
               slug,
               sources,
            )
            return { slug, type, available }
         })
         .filter((entry) => entry.available > 0)
      if (availableChoices.length === 0) continue
      const hasDifferentAvailable =
         loaded > 0 &&
         loadedSlugs.size > 0 &&
         availableChoices.some((entry) => {
            const candidates = AmmunitionManager._candidateSlugs(siege, entry.slug)
            return ![...loadedSlugs].every((loadedSlug) =>
               candidates.has(loadedSlug),
            )
         })
      const room = replacingCharged
         ? 1
         : hasDifferentAvailable
           ? max
           : Math.max(0, max - loaded)
      if (room <= 0) continue
      const cap = replacingCharged
         ? 1
         : Math.min(room, Math.max(...availableChoices.map((entry) => entry.available)))
      if (cap <= 0) continue
      const ammoName = ammoChoices.map(({ type }) => type.name).join(" / ")
      rows.push({
         id: action.id,
         name: action.name,
         ammoName,
         ammoDetail: AmmunitionManager.weaponryAmmoDetail(siege, action),
         ammoTypesHtml: ammoTypesAccordionHTML(siege, action),
         replacingCharged,
         loaded,
         max,
         cap,
      })
   }
   return rows
}





function _buildSourceOptions(sources, crewman) {
   const escape = (s) => foundry.utils.escapeHTML?.(s ?? "") ?? String(s ?? "")
   const crewmanOpt = `<option value="${crewman.uuid}" selected>${escape(crewman.name)}</option>`

   const groupLabels = {
      loot: tKey("Load.SourceGroups.Loot"),
      npc: tKey("Load.SourceGroups.Npc"),
      vehicle: tKey("Load.SourceGroups.Vehicle"),
      familiar: tKey("Load.SourceGroups.Familiar"),
      character: tKey("Load.SourceGroups.Character"),
   }

   const groups = AMMO_SOURCE_PRIORITY.map((type) => {
      const inGroup = sources
         .filter((a) => a.id !== crewman.id && a.type?.toLowerCase() === type)
         .sort((a, b) => a.name.localeCompare(b.name))
      if (inGroup.length === 0) return ""
      const opts = inGroup
         .map((a) => `<option value="${a.uuid}">${escape(a.name)}</option>`)
         .join("")
      return `<optgroup label="${groupLabels[type]}">${opts}</optgroup>`
   }).join("")

   return crewmanOpt + groups
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

function _bindStrikeLoadDialog() {
   const select = document.getElementById("load-strike-id")
   const input = document.getElementById("load-ammo-qty")
   const tracker = document.getElementById("load-ammo-tracker")
   const panels = Array.from(
      document.querySelectorAll(".siege-load-ammo-types-panel"),
   )
   if (!select || !input || !tracker) return
   const updateTracker = () => {
      const opt = select.options[select.selectedIndex]
      const cap = Math.max(1, parseInt(opt?.dataset?.cap) || 1)
      const replacing = opt?.dataset?.replacing === "1"
      input.max = String(cap)
      input.disabled = replacing
      if (replacing) input.value = "1"
      else if (input.value !== "" && (parseInt(input.value) || 1) > cap) {
         input.value = String(cap)
      }
      tracker.innerText = tKey("Load.Tracker", {
         current: opt?.dataset?.loaded ?? 0,
         max: opt?.dataset?.max ?? 1,
      })
      panels.forEach((panel) => {
         panel.style.display =
            panel.dataset.actionId === opt?.value ? "" : "none"
      })
   }
   select.addEventListener("change", updateTracker)
   input.addEventListener("input", () => {
      if (input.value === "") return
      const max = Math.max(1, parseInt(input.max) || 1)
      const value = parseInt(input.value)
      if (Number.isFinite(value) && value > max) input.value = String(max)
   })
   input.addEventListener("blur", () => {
      const max = Math.max(1, parseInt(input.max) || 1)
      const value = Math.max(1, Math.min(max, parseInt(input.value) || 1))
      input.value = String(value)
   })
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
   const safeAmmoTypes = Object.values(ammoTypes || {})
   const tInfo = safeAmmoTypes.find(
      (t) => slugify(t.slug || t.name) === choice.slug,
   )
   const maxCap =
      tInfo.max === "" || tInfo.max == null ? Infinity : parseInt(tInfo.max)
   const currentQty = AmmunitionManager.getCurrentAmmoCount(siege, choice.slug)
   const availableSpace = maxCap - currentQty

   if (availableSpace <= 0) {
      ui.notifications.warn(tKey("Notifications.MaxCapacityReachedGeneric"))
      return false
   }

   const requestedQty = parseInt(choice.qty) || 1
   const actualLoadQty = Math.min(requestedQty, availableSpace)
   let ammoProcured = 0
   const extracts = []

   const useAdjacent = SiegeSettings.takeAmmoFromAdjacent()

   
   
   let sourceActor = crewman
   if (useAdjacent && choice.sourceUuid) {
      const resolved = await fromUuid(choice.sourceUuid)
      if (resolved) sourceActor = resolved.actor ?? resolved
   }

   const ammoItems = sourceActor.items.filter(
      (i) =>
         AmmunitionManager.isAmmoItem(i) &&
         (i.system?.slug || slugify(i.name)) === choice.slug,
   )
   for (const ammoItem of ammoItems) {
      if (ammoProcured >= actualLoadQty) break
      const qtyAvailable = Number(ammoItem.system?.quantity) || 0
      if (qtyAvailable > 0) {
         const take = Math.min(qtyAvailable, actualLoadQty - ammoProcured)
         extracts.push({ uuid: ammoItem.uuid, take })
         ammoProcured += take
      }
   }

   if (ammoProcured === 0) {
      ui.notifications.warn(
         tKey("Notifications.MissingRequiredAmmo", { name: tInfo.name }),
      )
      return false
   }

   await SiegeSocketManager.executeLoad(
      siege.uuid,
      choice,
      extracts,
      crewman.uuid,
      ammoProcured,
      useAdjacent,
   )

   return true
}

export async function handleAbilityAttack(
   actionItem,
   siege,
   flag,
   detailsBody,
   applyEffects,
   crewman = null,
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
   const resolvedDC = resolveSaveDC(crewman, flag)
   const inlineSave = `@Check[type:reflex|dc:${resolvedDC}|traits:${flag.actionType}|showDC:all]`
   const inlineDamage = `@Damage[${damageFormula}]`

   const ephemeralData = actionItem.toObject()
   ephemeralData.system.description.value += `<hr><p class="siege-ability-template">${inlineTemplate}</p><p class="siege-ability-save">${inlineSave}</p><p class="siege-ability-damage">${inlineDamage}</p>`

   const tempAttack = new Item.implementation(ephemeralData, { parent: siege })
   const siegeTokenDoc = siege.getActiveTokens()[0]?.document
   const hookId = Hooks.once("preCreateChatMessage", (msg) => {
      msg.updateSource({
         "speaker.alias": siege.name,
         "speaker.token": siegeTokenDoc?.id || null,
         "flags.pf2e.origin.uuid": actionItem.uuid,
         "flags.pf2e.origin.type": actionItem.type,
         [`flags.${MODULE_ID}.siegeId`]: siege.id,
         [`flags.${MODULE_ID}.siegeUuid`]: siege.uuid,
         [`flags.${MODULE_ID}.siegeTokenId`]: siegeTokenDoc?.id || null,
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

export async function handleStrike(e, actionItem, siege, crewman, flag, ctx) {
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
      { ...flag, actionId: actionItem.id },
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
      siege,
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

   console.debug("[siege][range] strike roll", {
      siege: siege.name,
      action: actionItem.name,
      distance,
      configured: {
         blindRange: flag.blindRange || "",
         minRange: flag.minRange || "",
         rangeIncrement: flag.rangeIncrement || "",
         maxRange: flag.maxRange || "",
      },
      strikeSystem: {
         range: generatedStrike.item?.system?.range ?? null,
         maxRange: generatedStrike.item?.system?.maxRange ?? null,
      },
      strikeRange: generatedStrike.item?.range ?? null,
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
   app.close()
}

function _calcHighestStr(isPortable, detailsBody, siege) {
   if (!isPortable || !detailsBody.find(".siege-highest-str-cb").is(":checked"))
      return 0
   let highestStr = 0
   for (const actor of getCrewActors(siege)) {
      const strMod = actor.system.abilities?.str?.mod || 0
      if (strMod > highestStr) highestStr = strMod
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

   const newRules = foundry.utils.deepClone(mountedEffect.system.rules || [])
   let rulesChanged = false
   const chosenPosition = mountedEffect.getFlag(MODULE_ID, "position")
   const rebuiltRules = []
   for (const action of siege.items.filter((i) => i.type === "action")) {
      const actionFlag = action.getFlag(MODULE_ID, "siegeAction")
      if (!actionFlag || !actionFlag.isStrike) continue
      if (
         chosenPosition &&
         actionFlag.crewAccess?.length > 0 &&
         !actionFlag.crewAccess.includes(chosenPosition)
      )
         continue
      const effectiveFlag =
         action.name === strikeLabel || action.id === flag.actionId ? flag : actionFlag
      const strikeFlag = {
         ...effectiveFlag,
         strikeLabel: action.name,
         damageParts:
            action.name === strikeLabel && versatileType
               ? [
                    {
                       ...(effectiveFlag.damageParts?.[0] || {}),
                       type: versatileType,
                    },
                    ...(effectiveFlag.damageParts || []).slice(1),
                 ]
               : effectiveFlag.damageParts,
      }
      rebuiltRules.push(...buildStrikeRules(siege, strikeFlag, crewman))
   }
   if (JSON.stringify(newRules) !== JSON.stringify(rebuiltRules)) {
      newRules.splice(0, newRules.length, ...rebuiltRules)
      rulesChanged = true
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

   await SiegeSocketManager.modifySiegeItem(
      crewman.uuid,
      "update",
      [{ _id: mountedEffect.id, "system.rules": newRules }],
      { siegeActionRuleSync: true },
   )
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
      classes: ["siege-v2-dialog"],
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

   if (rollContext.vehiclePenalty < 0) {
      const m = makeModifier(
         "vehicle-attack-penalty",
         tKey("Modifiers.VehicleAttackPenalty"),
         rollContext.vehiclePenalty,
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
      const increments = Math.ceil(distance / rangeIncrement)
      const penalty = -2 * Math.max(0, increments - 1)
      if (penalty < 0) {
         const m = makeModifier(
            "range-increment",
            tKey("Modifiers.RangePenalty"),
            penalty,
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
   const storedTraitSlugs = splitCSV(flag.traits).filter(
      (t) =>
         !(
            t === "nonlethal" &&
            rollContext.baseHasNonlethal &&
            !rollContext.isNonlethalChecked
         ),
   )

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
      [`flags.${MODULE_ID}.rollOptions`]: flag.rollOptions || "",
      [`flags.${MODULE_ID}.traits`]: storedTraitSlugs.join(", "),
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
