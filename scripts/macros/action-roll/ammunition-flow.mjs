import { MODULE_ID } from "../../constants.mjs"
import { slugify, tKey, renderHbs, tplPath } from "../../utils.mjs"
import {
   loadActionsRequiredFor,
   loadPerformedCountFor,
   loadPerformedEffectFor,
   loadPerformedEffectName,
} from "../helpers.mjs"
import { AmmunitionManager } from "../../managers/ammunition.mjs"
import { SiegeSocketManager } from "../../managers/sockets.mjs"
import { ammoTypesAccordionHTML } from "../../ui/ammo-details.mjs"

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
         await _clearLoadPerformedProgress(siege, action, flag)
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
         await _clearLoadPerformedProgress(siege, action, flag)
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
      await _clearLoadPerformedProgress(siege, action, flag)
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

export function hasSpendableAmmo(siege, flag, action = null, options = {}) {
   const notify = options.notify !== false
   const warn = (key, data = {}) => {
      if (notify) ui.notifications.warn(tKey(key, data))
      return false
   }
   if (flag.usesAmmunition === false) return true
   const acceptedSlugs = AmmunitionManager.ammoSlugsForAction(flag)
   if (acceptedSlugs.length === 0)
      return warn("Notifications.UnassignedAmmo")
   if (!acceptedSlugs.some((slug) => AmmunitionManager.ammoTypeFor(siege, slug)))
      return warn("Notifications.UnassignedAmmo")

   const spendAmount = parseInt(flag.spend) || 1

   if (action) {
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
         const active = loadedPieces[activeIndex >= 0 ? activeIndex : 0]
         if (!active) return warn("Notifications.InsufficientAmmo")
         if (active.usesCharges)
            return active.charges >= spendAmount
               ? true
               : warn("Notifications.InsufficientAmmo")

         const ordered = [
            active,
            ...loadedPieces.filter(
               (piece) => piece.id !== active.id && piece.slug === active.slug,
            ),
            ...loadedPieces.filter(
               (piece) => piece.id !== active.id && piece.slug !== active.slug,
            ),
         ]
         return ordered.length >= spendAmount
            ? true
            : warn("Notifications.InsufficientAmmo")
      }

      let loadedCharges = AmmunitionManager.getStrikeLoadedCharges(siege, action)
      if (tplCharge.usesCharges && loadedCharges.length === 0 && loaded > 0)
         loadedCharges = Array.from({ length: loaded }, () => tplCharge.max)

      if (loadedCharges.length > 0) {
         const totalCharges = loadedCharges.reduce((sum, n) => sum + n, 0)
         return totalCharges >= spendAmount
            ? true
            : warn("Notifications.InsufficientAmmo")
      }

      return loaded >= spendAmount
         ? true
         : warn("Notifications.InsufficientAmmo")
   }

   const targetSlug = acceptedSlugs[0]
   const ammoItem = siege.items.find(
      (i) => slugify(i.system?.slug || i.name) === targetSlug,
   )
   if (!ammoItem)
      return warn("Notifications.MissingRequiredAmmo", { name: targetSlug })
   const charge = AmmunitionManager._chargeInfo(ammoItem)
   const maxUses = charge.max
   const currentUses = charge.value
   const qty = ammoItem.system.quantity || 1
   const totalAvailable = maxUses > 0 ? (qty - 1) * maxUses + currentUses : qty
   return totalAvailable >= spendAmount
      ? true
      : warn("Notifications.InsufficientAmmo")
}

async function _clearLoadPerformedProgress(siege, action, flag = {}) {
   if (!siege || !action || loadActionsRequiredFor(flag) <= 1) return
   await AmmunitionManager.clearLoadProgressForAction(siege, action)
}

async function _recordLoadPerformed(siege, action, flag = {}) {
   const required = loadActionsRequiredFor(flag)
   if (!siege || !action || required <= 1) return null

   const existing = loadPerformedEffectFor(siege, action)
   const current = existing ? Number(existing.system.badge?.value) || 0 : 0
   const nextValue = Math.min(required, current + 1)
   if (existing) {
      await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", [
         {
            _id: existing.id,
            "system.badge.value": nextValue,
         },
      ])
      return nextValue
   }

   await SiegeSocketManager.modifySiegeItem(siege.uuid, "create", [
      {
         name: loadPerformedEffectName(action),
         type: "effect",
         img: action.img,
         system: {
            level: { value: 1 },
            duration: {
               value: -1,
               unit: "unlimited",
               sustained: false,
               expiry: null,
            },
            badge: { type: "counter", value: nextValue },
            description: {
               value: tKey("Markers.LoadPerformedDesc", { name: action.name }),
            },
            tokenIcon: { show: true },
         },
         flags: {
            [MODULE_ID]: {
               isSiegeMarker: true,
               isLoadPerformed: true,
               actionId: action.id,
               actionUuid: action.uuid,
            },
         },
      },
   ])
   return nextValue
}

export async function advanceLoadProgressOrReady(siege, action, flag = {}) {
   const required = loadActionsRequiredFor(flag)
   if (!siege || !action || required <= 1)
      return { ready: true, advanced: false, current: 0, target: required }

   const current = loadPerformedCountFor(siege, action)
   if (current >= required)
      return { ready: true, advanced: false, current, target: required }

   const nextLoadProgress = await _recordLoadPerformed(siege, action, flag)
   if (nextLoadProgress != null) {
      ui.notifications.info(
         tKey("Load.ProgressInfo", {
            name: action.name,
            current: nextLoadProgress,
            target: required,
         }),
      )
   }

   return {
      ready: (nextLoadProgress || 0) >= required,
      advanced: true,
      current: nextLoadProgress || current,
      target: required,
   }
}

export async function clearLoadProgressAfterLoad(siege, action, flag = {}) {
   await _clearLoadPerformedProgress(siege, action, flag)
}

export async function canAttemptWeaponReload(
   siege,
   action,
   crewman = null,
   options = {},
) {
   const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
   if (flag.usesAmmunition === false) return false
   const ammoChoices = AmmunitionManager.ammoTypesForAction(siege, flag)
   if (ammoChoices.length === 0) {
      ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
      return false
   }
   const max = AmmunitionManager.strikeMaxLoaded(action)
   const loadedPieces = AmmunitionManager.getLoadedAmmoPieces(siege, action)
   const loaded = Math.max(
      AmmunitionManager.getStrikeLoaded(siege, action),
      loadedPieces.length,
   )
   const replacingCharged =
      AmmunitionManager.reloadNeedsChargedReplacement(siege, action)
   const loadedSlugs = new Set(
      loadedPieces.map((piece) => slugify(piece.slug || piece.name)).filter(Boolean),
   )
   if (loaded > 0 && loadedSlugs.size === 0) {
      const activeSlug = AmmunitionManager.activeAmmoSlug(siege, action)
      if (activeSlug) loadedSlugs.add(slugify(activeSlug))
   }
   const sources = await AmmunitionManager.collectLoadSources(siege, crewman, {
      includeAdjacent: true,
   })
   const availableChoices = ammoChoices
      .map(({ slug, type }) => ({
         slug,
         type,
         available: AmmunitionManager.getAvailableLoadUnitsFromSources(
            siege,
            slug,
            sources,
         ),
      }))
      .filter((entry) => entry.available > 0)
   if (availableChoices.length === 0) {
      ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
      return false
   }
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
   if (room <= 0) {
      ui.notifications.info(tKey("Weaponry.AlreadyFull"))
      return false
   }
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
   const loadableStrikes = await _loadableStrikes(siege, crewman)
   if (loadableStrikes.length === 0) {
      if (_hasFullyLoadedAmmoStrike(siege))
         ui.notifications.info(tKey("Weaponry.AlreadyFull"))
      else ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
      return false
   }

   let choice = null
   const preselected = options.preselectedActionId
      ? loadableStrikes.find((s) => s.id === options.preselectedActionId)
      : null
   const onlyProgressTarget =
      loadableStrikes.length === 1 && loadableStrikes[0].progressOnly
   if (preselected?.progressOnly || onlyProgressTarget) {
      const target = preselected || loadableStrikes[0]
      choice = { actionId: target.id, qty: 1 }
   } else {
      const dialogContent = await renderHbs(
         tplPath("macros/load-strike-dialog.hbs"),
         {
            strikes: loadableStrikes.map((s) => ({
               ...s,
               selected: s.id === options.preselectedActionId,
               replacingAttr: s.replacingCharged ? "1" : "0",
               progressOnlyAttr: s.progressOnly ? "1" : "0",
               progressOnlyHint: tKey("Load.ProgressOnlyHint", { name: s.name }),
            })),
            labels: {
               strike: tKey("Load.Strike"),
               amount: tKey("Load.Amount"),
               ammunitionTypes: tKey("Weaponry.AmmunitionTypes"),
            },
            trackerText: tKey("Load.Tracker", {
               current: 0,
               max: tKey("Misc.Infinity"),
            }),
         },
      )

      choice = await foundry.applications.api.DialogV2.wait({
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
   }

   if (!choice) return false

   const strike = siege.items.get(choice.actionId)
   if (!strike) return false
   const strikeData = loadableStrikes.find((s) => s.id === choice.actionId)
   const strikeFlag = strike.getFlag(MODULE_ID, "siegeAction") || {}
   const progress = await advanceLoadProgressOrReady(siege, strike, strikeFlag)
   if (!progress.ready) return true

   const readyAmount = strikeData?.progressOnly
      ? await _promptReadyLoadAmount(siege, strike, strikeData)
      : {
           ok: true,
           amount: Math.max(
              1,
              Math.min(strikeData?.cap || 1, parseInt(choice.qty) || 1),
           ),
        }
   if (!readyAmount.ok) return false

   const loadSuccess = await SiegeSocketManager.reloadStrike(
      siege,
      strike,
      readyAmount.amount,
      {
         crewmanUuid: crewman?.uuid,
         useAdjacent: true,
         sourceContext: "load-macro",
      },
   )
   if (loadSuccess) await _clearLoadPerformedProgress(siege, strike, strikeFlag)
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
      const loadedPieces = AmmunitionManager.getLoadedAmmoPieces(siege, action)
      const loaded = Math.max(
         AmmunitionManager.getStrikeLoaded(siege, action),
         loadedPieces.length,
      )
      const loadRequired = loadActionsRequiredFor(flag)
      const loadProgress = loadPerformedCountFor(siege, action)
      const replacingCharged =
         AmmunitionManager.reloadNeedsChargedReplacement(siege, action)
      const loadedSlugs = new Set(
         loadedPieces.map((piece) => slugify(piece.slug || piece.name))
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
      const progressOnly = loadRequired > 1 && loadProgress < loadRequired
      rows.push({
         id: action.id,
         name: action.name,
         ammoName,
         ammoDetail: AmmunitionManager.weaponryAmmoDetail(siege, action),
         ammoTypesHtml: progressOnly ? "" : ammoTypesAccordionHTML(siege, action),
         replacingCharged,
         progressOnly,
         loadProgress,
         loadRequired,
         loaded,
         max,
         cap,
      })
   }
   return rows
}

async function _promptReadyLoadAmount(siege, strike, strikeData = {}) {
   const flag = strike.getFlag(MODULE_ID, "siegeAction") || {}
   const active = AmmunitionManager.getActiveLoadedPiece(siege, strike)
   const usesCharges = !!active?.usesCharges
   const multiType = AmmunitionManager.ammoSlugsForAction(flag).length > 1
   if (usesCharges || multiType) return { ok: true, amount: null }

   const cap = Math.max(1, parseInt(strikeData.cap) || 1)
   if (cap <= 1) return { ok: true, amount: 1 }

   const result = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: `${tKey("Weaponry.Reload")} - ${strike.name}` },
      content: await renderHbs(tplPath("macros/ready-load-amount-dialog.hbs"), {
         label: tKey("Weaponry.ReloadAmount", { max: cap }),
         value: cap,
         max: cap,
      }),
      buttons: [
         {
            action: "ok",
            label: tKey("Weaponry.Reload"),
            default: true,
            callback: (event, button, dialog) => {
               const root = dialog?.element ?? button?.form ?? document
               const value =
                  root?.querySelector?.(".siege-ready-load-amount")?.value ??
                  document.querySelector(".siege-ready-load-amount")?.value
               return Math.max(1, Math.min(cap, parseInt(value) || 1))
            },
         },
         {
            action: "cancel",
            label: tKey("Buttons.Cancel"),
            callback: () => null,
         },
      ],
   }).catch(() => null)

   return result ? { ok: true, amount: result } : { ok: false, amount: null }
}

function _hasFullyLoadedAmmoStrike(siege) {
   return siege.items.some((action) => {
      if (action.type !== "action") return false
      const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
      if (!(flag.isStrike || flag.isAttack) || flag.usesAmmunition === false)
         return false
      if (AmmunitionManager.ammoTypesForAction(siege, flag).length === 0)
         return false
      const max = AmmunitionManager.strikeMaxLoaded(action)
      return (
         Math.max(
            AmmunitionManager.getStrikeLoaded(siege, action),
            AmmunitionManager.getLoadedAmmoPieces(siege, action).length,
         ) >= max
      )
   })
}

function _bindStrikeLoadDialog() {
   const select = document.getElementById("load-strike-id")
   const input = document.getElementById("load-ammo-qty")
   const qtyRow = document.getElementById("load-ammo-qty-row")
   const tracker = document.getElementById("load-ammo-tracker")
   const panels = Array.from(
      document.querySelectorAll(".siege-load-ammo-types-panel"),
   )
   if (!select || !input || !tracker) return
   const updateTracker = () => {
      const opt = select.options[select.selectedIndex]
      const cap = Math.max(1, parseInt(opt?.dataset?.cap) || 1)
      const replacing = opt?.dataset?.replacing === "1"
      const progressOnly = opt?.dataset?.progressOnly === "1"
      input.max = String(cap)
      input.disabled = replacing || progressOnly
      if (qtyRow) qtyRow.style.display = progressOnly ? "none" : ""
      if (replacing || progressOnly) input.value = "1"
      else if (input.value !== "" && (parseInt(input.value) || 1) > cap) {
         input.value = String(cap)
      }
      tracker.innerText = progressOnly
         ? tKey("Load.ProgressTracker", {
              current: opt?.dataset?.progress ?? 0,
              max: opt?.dataset?.progressTarget ?? 1,
           })
         : tKey("Load.Tracker", {
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

