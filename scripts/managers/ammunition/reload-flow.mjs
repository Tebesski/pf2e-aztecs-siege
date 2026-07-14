import { MODULE_ID, DEFAULT_AMMO_IMG, PHYSICAL_ITEM_TYPES } from "../../constants.mjs"
import { slugify, splitCSV, tKey } from "../../utils.mjs"
import { SiegeSFXManager } from "../sfx.mjs"
import { AMMO_LOAD_SOURCE_PRIORITY } from "./helpers.mjs"

class AmmunitionReloadFlowMixin {
   static async promptAmmoTypeChoice(
      vehicle,
      action,
      purpose = "reload",
      sourceOptions = {},
   ) {
      const choices = this.ammoTypesForAction(vehicle, action)
      if (choices.length === 0) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return null
      }
      if (choices.length === 1) return choices[0].slug

      const sources = await this.collectLoadSources(
         vehicle,
         sourceOptions.crewmanUuid || sourceOptions.crewman,
         { includeAdjacent: sourceOptions.useAdjacent !== false },
      )
      const withAmount = sourceOptions.withAmount === true && purpose === "reload"
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      const loaded = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      const activeSlug = loaded > 0 ? this.activeAmmoSlug(vehicle, action) : null
      const max = this.strikeMaxLoaded(action)
      const loadedSlugs = this._loadedAmmoTypeSlugs(vehicle, action, pieces)
      const replacingCharged = this.reloadNeedsChargedReplacement(vehicle, action)
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const entries = choices.map(({ slug, type }) => {
         const available = this.getAvailableLoadUnitsFromSources(
            vehicle,
            slug,
            sources,
         )
         const targetCandidates = this._candidateSlugs(vehicle, slug)
         const sameLoaded =
            loadedSlugs.size === 0 ||
            [...loadedSlugs].every((loadedSlug) => targetCandidates.has(loadedSlug))
         const room = replacingCharged ? 1 : sameLoaded ? max - loaded : max
         const cap = Math.max(0, Math.min(room, available))
         return { slug, type, available, cap }
      })
      const firstEnabled = entries.find((entry) => entry.cap > 0)
      const highestCap = Math.max(1, ...entries.map((entry) => entry.cap))
      const optionMarkup = entries
         .map(({ slug, type, available, cap }) => {
            const disabled = purpose === "reload" && cap <= 0 ? "disabled" : ""
            const selected = firstEnabled?.slug === slug ? "selected" : ""
            const active = slug === activeSlug ? ` ${tKey("Weaponry.ActiveMarker")}` : ""
            return `<option value="${escape(slug)}" data-cap="${cap}" ${disabled} ${selected}>${escape(type.name)} (${tKey("Weaponry.InReserve", { n: available })})${active}</option>`
         })
         .join("")
      if (
         !optionMarkup ||
         (purpose === "reload" && !entries.some((entry) => entry.cap > 0))
      ) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return null
      }
      const amountMarkup = withAmount
         ? `<div class="form-group stacked">
            <label>${tKey("Load.Amount")}</label>
            <input type="number" class="siege-ammo-type-amount" value="${firstEnabled?.cap || 1}" min="1" max="${highestCap}">
         </div>`
         : ""

      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.SelectAmmoTypeTitle") },
         content: `<div class="form-group stacked">
            <label>${tKey("Load.Ammunition")}</label>
            <select class="siege-ammo-type-choice">${optionMarkup}</select>
         </div>
         ${amountMarkup}`,
         buttons: [
            {
               action: "ok",
               label: tKey("Buttons.Confirm"),
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? document
                  const select = root.querySelector(".siege-ammo-type-choice")
                  const slug = select?.value || null
                  if (!slug || !withAmount) return slug
                  const cap = Math.max(
                     1,
                     parseInt(select.selectedOptions?.[0]?.dataset?.cap) || 1,
                  )
                  const raw = parseInt(
                     root.querySelector(".siege-ammo-type-amount")?.value,
                  )
                  return { slug, amount: Math.max(1, Math.min(cap, raw || cap)) }
               },
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      const resultSlug =
         result && typeof result === "object" ? result.slug : result
      const slug = resultSlug ? slugify(resultSlug) : null
      if (!choices.some((choice) => choice.slug === slug)) return null
      if (withAmount && result && typeof result === "object")
         return { slug, amount: result.amount }
      return slug
   }

   static async reloadStrike(vehicle, action, amount = null, options = {}) {
      const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
      if (flag.usesAmmunition === false) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return false
      }
      const supportedSlugs = this.ammoSlugsForAction(flag)
      let slug = slugify(options.slug || options.ammoSlug || "")
      if (!slug || !supportedSlugs.includes(slug)) {
         if (supportedSlugs.length === 0) {
            ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
            return false
         }
         if (supportedSlugs.length === 1) slug = supportedSlugs[0]
         else {
            const choice = await this.promptAmmoTypeChoice(
               vehicle,
               action,
               "reload",
               { ...options, withAmount: amount == null },
            )
            if (choice && typeof choice === "object") {
               slug = choice.slug
               if (amount == null) amount = choice.amount
            } else slug = choice
            if (!slug) return false
         }
      }
      if (!slug || !this.ammoTypeFor(vehicle, slug)) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return false
      }
      const max = this.strikeMaxLoaded(action)
      let pieces = this.getLoadedAmmoPieces(vehicle, action)
      let current = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      if (
         !(await this._ensureSingleLoadedAmmoType(vehicle, action, slug, pieces, {
            confirmedReplace: options.replaceLoadedAmmoType === true,
         }))
      )
         return false
      pieces = this.getLoadedAmmoPieces(vehicle, action)
      current = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      const sources = await this.collectLoadSources(
         vehicle,
         options.crewmanUuid || options.crewman,
         { includeAdjacent: options.useAdjacent !== false },
      )
      const chargeBased =
         this.ammoUsesCharges(vehicle, slug) ||
         this.ammoUsesChargesFromSources(vehicle, slug, sources)

      if (chargeBased)
         return this._reloadChargedStrike(
            vehicle,
            action,
            slug,
            max,
            amount,
            { ...options, sources },
         )

      let need = Math.max(0, max - current)
      if (amount != null) need = Math.min(need, Math.max(0, parseInt(amount) || 0))
      if (need <= 0) {
         ui.notifications.info(tKey("Weaponry.AlreadyFull"))
         return false
      }

      const available = this.getAvailableLoadUnitsFromSources(
         vehicle,
         slug,
         sources,
      )
      const toLoad = Math.min(need, available)
      if (toLoad <= 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }

      const extracted = await this._consumeNonChargedLoadUnitsFromSources(
         vehicle,
         slug,
         toLoad,
         sources,
      )
      if (!extracted.ok) return false
      const tpl = extracted.template
      const newPieces = Array.from({ length: toLoad }, (_v, index) =>
         this._pieceFromTemplate(tpl, 1, pieces.length + index, slug),
      ).filter(Boolean)
      const nextPieces = [...pieces, ...newPieces]
      await this.setLoadedAmmoPieces(
         vehicle,
         action.id,
         nextPieces,
         this.getActiveLoadedPieceId(vehicle, action) || newPieces[0]?.id,
      )
      if (tpl) await this.setLoadedAmmoTemplate(vehicle, action.id, tpl)
      SiegeSFXManager.play(vehicle, `load-${slug}`, options.sourceUserId)
      ui.notifications.info(
         tKey("Weaponry.Reloaded", { name: action.name, n: current + toLoad }),
      )
      return true
   }

   static async promptChargedReplacement(vehicle, action, slug = null) {
      const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
      const targetSlug = slugify(
         slug || this.primaryAmmoSlugForAction(flag) || "",
      )
      const choices = this._ammoItemsFor(vehicle, targetSlug).filter((item) => {
         const charge = this._chargeInfo(item)
         return charge.usesCharges && (Number(item.system?.quantity) || 1) > 0
      })
      if (choices.length === 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return null
      }

      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const options = choices
         .map((item) => {
            const charge = this._chargeInfo(item)
            const qty = Number(item.system?.quantity) || 1
            const qtyText = qty > 1 ? `, x${qty}` : ""
            return `<option value="${item.id}">${escape(item.name)} (${charge.value}/${charge.max}${qtyText})</option>`
         })
         .join("")
      const loadedCharges = this.getLoadedChargeTotal(vehicle, action)
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.ReplaceTitle") },
         position: { width: 430 },
         content: `<div class="form-group stacked">
            <p class="notes">${tKey("Weaponry.ReplacePrompt", {
               name: action.name,
               charges: loadedCharges,
            })}</p>
            <label>${tKey("Load.Ammunition")}</label>
            <select class="siege-replace-ammo">${options}</select>
         </div>`,
         buttons: [
            {
               action: "replace",
               label: tKey("Weaponry.Replace"),
               icon: "fa-solid fa-rotate",
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? document
                  return {
                     itemId: root.querySelector(".siege-replace-ammo")?.value,
                  }
               },
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      return result?.itemId ? result : null
   }

   static async _reloadChargedStrike(
      vehicle,
      action,
      slug,
      max,
      amount = null,
      options = {},
   ) {
      let pieces = this.getLoadedAmmoPieces(vehicle, action)
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const room = Math.max(0, max - pieces.length)
      const sources =
         options.sources ||
         (await this.collectLoadSources(
            vehicle,
            options.crewmanUuid || options.crewman,
            { includeAdjacent: options.useAdjacent !== false },
         ))
      const available = this.getAvailableLoadUnitsFromSources(
         vehicle,
         slug,
         sources,
      )
      let choice = options?.mode
         ? options
         : pieces.length > 0
            ? await this.promptChargedReloadChoice(vehicle, action, slug, {
                 ...options,
                 available,
              })
            : { mode: "loadMore" }
      if (!choice) return false

      if (choice.mode === "replace") {
         const pieceId = choice.pieceId || activeId
         const replaceIndex = pieces.findIndex((piece) => piece.id === pieceId)
         if (replaceIndex < 0) {
            ui.notifications.warn(tKey("Weaponry.NoLoadedPiece"))
            return false
         }
         const itemId = choice.itemId || choice.replaceItemId
         if (!itemId) return false
         const oldPiece = pieces[replaceIndex]
         const extracted = await this._extractLoadedUnits(vehicle, slug, 1, itemId)
         if (!extracted.ok || extracted.pieces.length === 0) {
            ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
            return false
         }
         if (oldPiece.usesCharges)
            await this._addChargedPieces(vehicle, oldPiece.slug || slug, [oldPiece])
         else await this._addUnits(vehicle, oldPiece.slug || slug, 1, oldPiece.template)
         const newPiece = extracted.pieces[0]
         pieces[replaceIndex] = newPiece
         await this.setLoadedAmmoPieces(vehicle, action.id, pieces, newPiece.id)
         await this.setLoadedAmmoTemplate(vehicle, action.id, newPiece.template)
         SiegeSFXManager.play(vehicle, `load-${slug}`, options.sourceUserId)
         ui.notifications.info(
            tKey("Weaponry.ReplacedLoadedAmmo", { name: action.name }),
         )
         return true
      }

      const requested =
         amount == null ? room : Math.max(0, parseInt(amount) || 0)
      const toLoad = Math.min(room, available, requested)
      if (toLoad <= 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }
      const extracted = await this._extractChargedLoadUnitsFromSources(
         vehicle,
         slug,
         toLoad,
         sources,
      )
      if (!extracted.ok || extracted.pieces.length === 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }
      pieces.push(...extracted.pieces)
      const nextActive = activeId || extracted.pieces[0]?.id || null
      await this.setLoadedAmmoPieces(vehicle, action.id, pieces, nextActive)
      await this.setLoadedAmmoTemplate(
         vehicle,
         action.id,
         extracted.pieces[0]?.template || extracted.template,
      )
      SiegeSFXManager.play(vehicle, `load-${slug}`, options.sourceUserId)
      ui.notifications.info(
         tKey("Weaponry.Reloaded", { name: action.name, n: pieces.length }),
      )
      return true
   }

   static async promptChargedReloadChoice(
      vehicle,
      action,
      slug = null,
      options = {},
   ) {
      const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
      const targetSlug = slugify(
         slug || this.primaryAmmoSlugForAction(flag) || "",
      )
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const max = this.strikeMaxLoaded(action)
      const room = Math.max(0, max - pieces.length)
      let available = options.available
      if (available == null) {
         const sources = await this.collectLoadSources(
            vehicle,
            options.crewmanUuid || options.crewman,
            { includeAdjacent: options.useAdjacent !== false },
         )
         available = this.getAvailableLoadUnitsFromSources(
            vehicle,
            targetSlug,
            sources,
         )
      }
      const stash = this._ammoItemsFor(vehicle, targetSlug).filter((item) => {
         const charge = this._chargeInfo(item)
         return charge.usesCharges && (Number(item.system?.quantity) || 1) > 0
      })
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const pieceOptions = [
         room > 0 && available > 0
            ? `<option value="loadMore">${tKey("Weaponry.LoadMoreCharged", {
                 n: Math.min(room, available),
              })}</option>`
            : "",
         ...pieces.map(
            (piece) =>
               `<option value="${piece.id}">${escape(piece.name)}${piece.usesCharges ? ` ${piece.charges}/${piece.max}` : ""}${piece.id === activeId ? ` ${tKey("Weaponry.ActiveMarker")}` : ""}</option>`,
         ),
      ].join("")
      const stashOptions = stash
         .map((item) => {
            const charge = this._chargeInfo(item)
            const qty = Number(item.system?.quantity) || 1
            const qtyText = qty > 1 ? `, x${qty}` : ""
            return `<option value="${item.id}">${escape(item.name)} (${charge.value}/${charge.max}${qtyText})</option>`
         })
         .join("")
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.ChargedReloadTitle") },
         position: { width: 470 },
         content: `<div class="form-group stacked">
            <p class="notes">${tKey("Weaponry.ChargedReloadPrompt", {
               name: action.name,
            })}</p>
            <label>${tKey("Weaponry.LoadedPiece")}</label>
            <select class="siege-charged-choice">${pieceOptions}</select>
            <label>${tKey("Weaponry.ReplacementFromStash")}</label>
            <select class="siege-charged-stash">${stashOptions}</select>
         </div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("Weaponry.Reload"),
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? document
                  const selected =
                     root.querySelector(".siege-charged-choice")?.value ||
                     "loadMore"
                  if (selected === "loadMore") return { mode: "loadMore" }
                  return {
                     mode: "replace",
                     pieceId: selected,
                     itemId: root.querySelector(".siege-charged-stash")?.value,
                  }
               },
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      if (result?.mode === "replace") {
         if (!result.itemId) {
            ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
            return null
         }
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("Weaponry.ReplaceTitle") },
            content: `<p>${tKey("Weaponry.ReplaceLoadedPieceConfirm")}</p>`,
            rejectClose: false,
         }).catch(() => false)
         if (!confirmed) return null
      }
      return result
   }

   static _switchableAmmoSlugs(vehicle, action) {
      const currentSlug = slugify(
         this.getActiveLoadedPiece(vehicle, action)?.slug ||
            this.activeAmmoSlug(vehicle, action),
      )
      return this.ammoSlugsForAction(action)
         .filter((slug) => slug && slug !== currentSlug)
         .filter((slug) => this.ammoTypeFor(vehicle, slug))
         .filter((slug) => this.getAvailableLoadUnits(vehicle, slug) > 0)
   }

   static async switchActiveLoadedAmmo(vehicle, action, choice = null) {
      const selected = choice || (await this.promptSwitchLoadedAmmoChoice(vehicle, action))
      if (!selected) return false
      if (typeof selected === "string")
         return this.setActiveLoadedPiece(vehicle, action, selected)
      if (selected.pieceId) return this.setActiveLoadedPiece(vehicle, action, selected.pieceId)
      if (selected.ammoSlug)
         return this.replaceLoadedAmmoType(
            vehicle,
            action,
            selected.ammoSlug,
            selected.amount,
         )
      return false
   }

   static async replaceLoadedAmmoType(vehicle, action, ammoSlug, amount = null) {
      const slug = slugify(ammoSlug)
      const supportedSlugs = this.ammoSlugsForAction(action)
      if (!slug || !supportedSlugs.includes(slug) || !this.ammoTypeFor(vehicle, slug)) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return false
      }
      if (this.getAvailableLoadUnits(vehicle, slug) <= 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      if (pieces.length === 0 && this.getStrikeLoaded(vehicle, action) <= 0) {
         ui.notifications.info(tKey("Weaponry.NothingLoaded"))
         return false
      }
      const loaded = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      const replaceAmount = Math.max(1, parseInt(amount) || loaded || 1)
      return this.reloadStrike(vehicle, action, replaceAmount, {
         slug,
         replaceLoadedAmmoType: true,
         useAdjacent: true,
      })
   }

   static canSwitchLoadedAmmo(vehicle, action) {
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      const current = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      if (current <= 0 || pieces.length === 0) return false
      const loadedSlugs = new Set(pieces.map((piece) => slugify(piece.slug || piece.name)))
      if (pieces.length > 1 && (pieces.some((piece) => piece.usesCharges) || loadedSlugs.size > 1))
         return true
      return this._switchableAmmoSlugs(vehicle, action).length > 0
   }

   static async promptSwitchLoadedAmmoChoice(vehicle, action) {
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      if (!this.canSwitchLoadedAmmo(vehicle, action)) {
         ui.notifications.info(tKey("Weaponry.NoAlternateLoadedAmmo"))
         return null
      }
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const currentLoaded = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      const max = this.strikeMaxLoaded(action)
      const loadedSlugs = new Set(pieces.map((piece) => slugify(piece.slug || piece.name)))
      const loadedOptions =
         pieces.length > 1 && (pieces.some((piece) => piece.usesCharges) || loadedSlugs.size > 1)
            ? pieces
                 .map(
                    (piece) =>
                       `<option value="piece:${escape(piece.id)}" ${piece.id === activeId ? "selected" : ""}>${escape(piece.name)}${piece.usesCharges ? ` ${piece.charges}/${piece.max}` : ""}${piece.id === activeId ? ` ${tKey("Weaponry.ActiveMarker")}` : ""}</option>`,
                 )
                 .join("")
            : ""
      const replacementOptions = this._switchableAmmoSlugs(vehicle, action)
         .map(
            (slug) =>
               `<option value="slug:${escape(slug)}">${escape(this.ammoTypeLabel(vehicle, slug) || slug)} (${tKey("Weaponry.InReserve", { n: this.getAvailableLoadUnits(vehicle, slug) })})</option>`,
         )
         .join("")
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.SwitchLoadedTitle") },
         content: `<div class="form-group stacked">
            <label>${tKey("Weaponry.SwitchTo")}</label>
            <select class="siege-switch-loaded">${loadedOptions}${replacementOptions}</select>
         </div>
         <div class="form-group stacked">
            <label>${tKey("Load.Amount")}</label>
            <input type="number" class="siege-switch-amount" value="${Math.min(max, currentLoaded || 1)}" min="1" max="${max}">
         </div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("Weaponry.SwitchLoaded"),
               default: true,
               callback: (event, button, dialog) => ({
                  value:
                     (dialog?.element ?? document).querySelector(".siege-switch-loaded")?.value ||
                     null,
                  amount: Math.max(
                     1,
                     Math.min(
                        max,
                        parseInt(
                           (dialog?.element ?? document).querySelector(
                              ".siege-switch-amount",
                           )?.value,
                        ) || currentLoaded || 1,
                     ),
                  ),
               }),
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
      }).catch(() => null)
      const value = result?.value || null
      if (!value) return null
      if (value.startsWith("piece:")) return { pieceId: value.slice(6) }
      if (value.startsWith("slug:"))
         return { ammoSlug: value.slice(5), amount: result.amount }
      return { pieceId: value }
   }

   static async promptChargedUnloadChoice(vehicle, action, pieces = null) {
      const loadedPieces = pieces || this.getLoadedAmmoPieces(vehicle, action)
      if (loadedPieces.length <= 1) return loadedPieces.map((piece) => piece.id)
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const rows = loadedPieces
         .map(
            (piece) => `<label class="siege-charged-unload-piece">
               <input type="checkbox" class="siege-charged-unload-cb" value="${escape(piece.id)}" checked>
               <span>${escape(piece.name)}${piece.usesCharges ? ` ${piece.charges}/${piece.max}` : ""}${piece.id === activeId ? ` ${tKey("Weaponry.ActiveMarker")}` : ""}</span>
            </label>`,
         )
         .join("")
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.ChargedUnloadTitle") },
         position: { width: 430 },
         content: `<div class="form-group stacked">
            <p class="notes">${tKey("Weaponry.ChargedUnloadPrompt", {
               name: action.name,
            })}</p>
            <div class="siege-charged-unload-list">${rows}</div>
         </div>`,
         buttons: [
            {
               action: "unload",
               label: tKey("Weaponry.Unload"),
               icon: "fa-solid fa-arrow-down",
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? document
                  return [
                     ...root.querySelectorAll(".siege-charged-unload-cb:checked"),
                  ].map((el) => el.value)
               },
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      return Array.isArray(result) ? result : null
   }

static async unloadStrike(vehicle, action, amount = null, options = {}) {
      const slug = this.activeAmmoSlug(vehicle, action)
      const current = this.getStrikeLoaded(vehicle, action)
      if (current <= 0) {
         ui.notifications.info(tKey("Weaponry.NothingLoaded"))
         return false
      }
      let n = current
      if (amount != null) n = Math.min(current, Math.max(0, parseInt(amount) || 0))
      if (n <= 0) return false

      const returnActor = vehicle

const templates = vehicle.getFlag(MODULE_ID, "loadedAmmoTemplates") || {}
      const tpl = templates[action.id]
      const tplCharge = this._chargeInfo(tpl)
      const loadedCharges = this.getStrikeLoadedCharges(vehicle, action)
      const loadedPieces = this.getLoadedAmmoPieces(vehicle, action)
      if (tplCharge.usesCharges || loadedCharges.length > 0 || loadedPieces.length > 0) {
         const seeded =
            loadedPieces.length > 0
               ? loadedPieces
               : (loadedCharges.length > 0
                    ? loadedCharges
                    : Array.from({ length: current }, () => tplCharge.max)
                 )
                    .map((value, index) =>
                       this._pieceFromTemplate(tpl, value, index, slug),
                    )
                    .filter(Boolean)
         let selectedIds = Array.isArray(options.pieceIds)
            ? options.pieceIds.map(String)
            : null
         if (!selectedIds && amount == null && seeded.length > 1) {
            selectedIds = await this.promptChargedUnloadChoice(vehicle, action, seeded)
            if (!selectedIds) return false
         }
         const selected = selectedIds
            ? new Set(selectedIds)
            : new Set(seeded.slice(0, n).map((piece) => piece.id))
         const returned = seeded.filter((piece) => selected.has(piece.id))
         const remaining = seeded.filter((piece) => !selected.has(piece.id))
         if (returned.length === 0) return false
         n = returned.length
         const activeId = this.getActiveLoadedPieceId(vehicle, action)
         const nextActive = remaining.some((piece) => piece.id === activeId)
            ? activeId
            : remaining[0]?.id || null
         await this.setLoadedAmmoPieces(
            vehicle,
            action.id,
            remaining,
            nextActive,
         )
         const storedNow = this.getStrikeLoaded(vehicle, action)
         if (storedNow !== remaining.length) {
            ui.notifications.warn(tKey("Weaponry.UnloadFailed"))
            return false
         }
         for (const piece of returned) {
            if (piece.usesCharges)
               await this._addChargedPieces(returnActor, piece.slug || slug, [piece])
            else await this._addUnits(returnActor, piece.slug || slug, 1, piece.template)
         }
      } else {
         const remaining = current - n
         await this.setStrikeLoaded(vehicle, action.id, remaining)
         const storedNow = this.getStrikeLoaded(vehicle, action)
         if (storedNow !== remaining) {
            ui.notifications.warn(tKey("Weaponry.UnloadFailed"))
            return false
         }
         await this._addUnits(returnActor, slug, n, tpl)
      }
      await this.clearLoadProgressForAction(vehicle, action)
      ui.notifications.info(
         tKey("Weaponry.Unloaded", { name: action.name, n }),
      )
      return true
   }

}

export const ammunitionReloadFlowMethods = Object.fromEntries(
   Object.getOwnPropertyNames(AmmunitionReloadFlowMixin)
      .filter((name) => !["length", "name", "prototype"].includes(name))
      .map((name) => [name, AmmunitionReloadFlowMixin[name]]),
)
