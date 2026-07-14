import { MODULE_ID } from "../../constants.mjs"
import { AmmunitionManager } from "../../managers/ammunition.mjs"
import { slugify, tKey } from "../../utils.mjs"
import { ammoTypesAccordionHTML } from "../ammo-details.mjs"
import { actionDisabledReason } from "../../macros/helpers.mjs"
import {
   advanceLoadProgressOrReady,
   canAttemptWeaponReload,
   clearLoadProgressAfterLoad,
} from "../../macros/action-roll.mjs"
import { staticMethods } from "./helpers.mjs"

class SheetAmmunitionMixin {

   static _transformInventoryToAmmunition(app, html) {

const navInv = html.find('.sheet-navigation a[data-tab="inventory"]')
      if (navInv.length > 0) {
         navInv.attr("data-tooltip", tKey("Tabs.Stash"))
         navInv.html('<i class="fa-solid fa-box-archive"></i>')
      }

const weaponRows = this._weaponryRowsForSheet(app.document)
      const isGM = game.user.isGM
      const reloadListHtml = weaponRows.length
         ? `<ul class="items siege-weaponry-list">${weaponRows
              .map(
                 (w) => `
            <li class="item siege-weapon-row ${w.disabled ? "siege-action-disabled" : ""}" data-action-id="${w.id}">
               <img class="siege-weapon-icon" src="${w.img}">
               <span class="siege-weapon-name">${w.name}</span>
               ${
                  w.disabled
                     ? `<span class="siege-weapon-disabled-reason">${w.disabledReason}</span>`
                     : ""
               }
               ${
                  w.usesAmmunition
                     ? `<a class="siege-weapon-ammo siege-sheet-ammo-types" data-action-id="${w.id}">${tKey("Weaponry.AmmunitionTypes")}</a>`
                     : `<span class="siege-weapon-ammo">${tKey("Weaponry.NoAmmunition")}</span>`
               }
               ${
                  w.usesAmmunition
                     ? `<span class="siege-weapon-count">${w.loaded} / ${w.max}</span>`
                     : ""
               }
               ${
                  isGM && w.usesAmmunition
                     ? `<a class="siege-sheet-reload" data-action-id="${w.id}" ${w.disabled ? "disabled" : ""} data-tooltip="${tKey("Weaponry.Reload")}"><i class="fa-solid fa-rotate"></i></a>
                        <a class="siege-sheet-switch-loaded" data-action-id="${w.id}" ${w.canSwitch && !w.disabled ? "" : "disabled"} data-tooltip="${tKey("Weaponry.SwitchLoaded")}"><i class="fa-solid fa-arrow-right-arrow-left"></i></a>
                        <a class="siege-sheet-unload" data-action-id="${w.id}" ${w.disabled ? "disabled" : ""} data-tooltip="${tKey("Weaponry.Unload")}"><i class="fa-solid fa-arrow-down"></i></a>`
                     : ""
               }
            </li>`,
              )
              .join("")}</ul>`
         : `<p class="notes">${tKey("VehicleHUD.NoWeaponry")}</p>`

      const ammoTypes = app.document.getFlag(MODULE_ID, "ammunitionTypes") || []
      const phName = tKey("Ammunition.Name")
      const phSlug = tKey("Ammunition.Slug")
      const defaultAmmoIcon = "icons/svg/target.svg"

      const typesListHtml = ammoTypes
         .map(
            (type, index) => `
         <li class="item ammo-type-row" data-index="${index}">
            <div class="ammo-inputs">
               <a class="ammo-type-icon" data-index="${index}"><img src="${type.img || defaultAmmoIcon}" alt=""></a>
               <input type="text" class="ammo-input-text ammo-type-name" placeholder="${phName}" value="${type.name ?? ""}">
               <input type="text" class="ammo-input-text ammo-type-slug" placeholder="${phSlug}" value="${type.slug ?? ""}">
               <a class="remove-ammo-type" data-tooltip="${tKey("Ammunition.Remove")}"><i class="fa-solid fa-trash"></i></a>
            </div>
         </li>
      `,
         )
         .join("")

if (html.find('a[data-tab="weaponry"]').length === 0) {
         const navTarget = navInv.length
            ? navInv
            : html.find('.sheet-navigation a[data-tab="actions"]')
         navTarget.before(
            `<a class="item" data-tab="weaponry" data-tooltip="${tKey("Tabs.Weaponry")}"><i class="fa-solid fa-crosshairs"></i></a>`,
         )
      }
      if (html.find('.tab.weaponry[data-tab="weaponry"]').length === 0) {
         const body = `
            <div class="tab weaponry siege-weaponry-tab" data-tab="weaponry">
               <div class="siege-weaponry-panel">
                  <header class="siege-header-alt"><h3>${tKey("Tabs.Weaponry")}</h3></header>
                  ${reloadListHtml}
                  <div class="siege-ammo-types-dropzone">
                     <header class="siege-header-alt siege-ammo-types-header">
                        <h3>${tKey("Ammunition.TypesHeader")}</h3>
                        <a class="add-ammo-type" data-tooltip="${tKey("Ammunition.Add")}"><i class="fa-solid fa-plus"></i></a>
                     </header>
                     <p class="siege-ammo-droptip"><i class="fa-solid fa-arrow-down-to-bracket"></i> ${tKey("Ammunition.DropTip")}</p>
                     <ul class="items siege-ammo-types-list">${typesListHtml}</ul>
                  </div>
               </div>
            </div>`
         const content = html.find(".sheet-content")
         if (content.length) content.append(body)
         else html.find(".tab.inventory").after(body)
      }

      const weaponryTab = html.find('.tab.weaponry[data-tab="weaponry"]')
      this._bindAmmoListeners(app, weaponryTab)
      this._bindSheetReloadListeners(app, weaponryTab)
   }



   static _weaponryRowsForSheet(vehicle) {
      const rows = []
      const actions = vehicle.items.filter((i) => i.type === "action")
      for (const a of actions) {
         const flag = a.getFlag(MODULE_ID, "siegeAction") || {}
         if (!(flag.isStrike || flag.isAttack)) continue
         const disabledReason = actionDisabledReason(flag)
         const usesAmmunition = flag.usesAmmunition !== false
         const max = parseInt(flag.maxLoaded) || 1
         const loaded = AmmunitionManager.getStrikeLoaded(vehicle, a)
         const ammoChoices = usesAmmunition
            ? AmmunitionManager.ammoTypesForAction(vehicle, flag)
            : []
         const active = AmmunitionManager.getActiveLoadedPiece(vehicle, a)
         const ammoDetail =
            ammoChoices.length > 0
               ? AmmunitionManager.weaponryAmmoDetail(vehicle, a)
               : ""
         const ammoName =
            active?.name ||
            ammoChoices.map(({ type }) => type.name).join(" / ") ||
            tKey("Ammunition.TypeUnassigned")
         rows.push({
            id: a.id,
            name: a.name,
            img: a.img || "icons/svg/target.svg",
            ammoName,
            usesAmmunition,
            usesCharges: !!active?.usesCharges,
            canSwitch: AmmunitionManager.canSwitchLoadedAmmo(vehicle, a),
            ammoDetail,
            loaded,
            max,
            disabled: !!disabledReason,
            disabledReason,
         })
      }
      return rows
   }



   static async _showSheetAmmoTypesDialog(vehicle, action) {
      const content = `<div class="siege-sheet-ammo-dialog">
         ${ammoTypesAccordionHTML(vehicle, action)}
      </div>`
      await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog", "siege-actions-app"],
         window: {
            title: `${action.name} - ${tKey("Weaponry.AmmunitionTypes")}`,
         },
         position: { width: 520 },
         content,
         buttons: [{ action: "close", label: tKey("CrewHUD.Cancel"), default: true }],
      }).catch(() => null)
   }



   static _bindSheetReloadListeners(app, invTab) {
      const vehicle = app.document
      const prompt = async (action, mode) => {
         const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
         const slug =
            mode === "reload"
               ? AmmunitionManager.primaryAmmoSlugForAction(flag)
               : AmmunitionManager.activeAmmoSlug(vehicle, action)
         const max = parseInt(flag.maxLoaded) || 1
         const loaded = AmmunitionManager.getStrikeLoaded(vehicle, action)
         let cap
         if (mode === "reload") {
            if (!slug || !AmmunitionManager.ammoTypeFor(vehicle, slug)) {
               ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
               return null
            }
            const replacingCharged =
               AmmunitionManager.reloadNeedsChargedReplacement(vehicle, action)
            cap = replacingCharged
               ? Math.min(1, AmmunitionManager.getAvailableLoadUnits(vehicle, slug))
               : Math.min(
                    max - loaded,
                    AmmunitionManager.ammoUsesCharges(vehicle, slug)
                       ? AmmunitionManager.getAvailableLoadUnits(vehicle, slug)
                       : AmmunitionManager.getAvailableUnits(vehicle, slug),
                 )
         } else cap = loaded
         if (cap <= 0) {
            ui.notifications.warn(
               mode === "reload"
                  ? tKey("Notifications.InsufficientAmmo")
                  : tKey("Weaponry.NothingLoaded"),
            )
            return null
         }
         const title = mode === "reload" ? tKey("Weaponry.Reload") : tKey("Weaponry.Unload")
         const v = await foundry.applications.api.DialogV2.wait({
            classes: ["siege-v2-dialog"],
            window: { title: `${title} — ${action.name}` },
            content: `<div style="padding:6px;"><input type="number" class="siege-amt" value="${cap}" min="1" max="${cap}" style="width:100%;"></div>`,
            buttons: [
               {
                  action: "ok",
                  label: title,
                  default: true,
                  callback: (e, b, d) => {
                     const el = (d?.element ?? document).querySelector(".siege-amt")
                     return Math.max(1, Math.min(cap, parseInt(el?.value) || 1))
                  },
               },
               { action: "cancel", label: tKey("CrewHUD.Cancel") },
            ],
         }).catch(() => null)
         return v ?? null
      }

      invTab.find(".siege-sheet-ammo-types").on("click", async (e) => {
         e.preventDefault()
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         await this._showSheetAmmoTypesDialog(vehicle, action)
      })

      invTab.find(".siege-sheet-reload").on("click", async (e) => {
         e.preventDefault()
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         const disabledReason = actionDisabledReason(action)
         if (disabledReason) {
            ui.notifications.warn(disabledReason)
            return
         }
         const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
         if (!(await canAttemptWeaponReload(vehicle, action))) return
         const progress = await advanceLoadProgressOrReady(vehicle, action, flag)
         if (!progress.ready) {
            app.render(false)
            return
         }
         const active = AmmunitionManager.getActiveLoadedPiece(vehicle, action)
         const usesCharges = !!active?.usesCharges
         const multiType =
            AmmunitionManager.ammoSlugsForAction(
               action.getFlag(MODULE_ID, "siegeAction") || {},
            ).length > 1
         const amt = usesCharges || multiType ? null : await prompt(action, "reload")
         if (!usesCharges && !multiType && amt === null) return
         const success = await AmmunitionManager.reloadStrike(vehicle, action, amt)
         if (success) await clearLoadProgressAfterLoad(vehicle, action, flag)
         app.render(false)
      })

      invTab.find(".siege-sheet-switch-loaded").on("click", async (e) => {
         e.preventDefault()
         if ($(e.currentTarget).attr("disabled") !== undefined) return
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         const disabledReason = actionDisabledReason(action)
         if (disabledReason) {
            ui.notifications.warn(disabledReason)
            return
         }
         const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
         const progress = await advanceLoadProgressOrReady(vehicle, action, flag)
         if (!progress.ready) {
            app.render(false)
            return
         }
         const success = await AmmunitionManager.switchActiveLoadedAmmo(vehicle, action)
         if (success) await clearLoadProgressAfterLoad(vehicle, action, flag)
         app.render(false)
      })

      invTab.find(".siege-sheet-unload").on("click", async (e) => {
         e.preventDefault()
         const action = vehicle.items.get($(e.currentTarget).data("actionId"))
         if (!action) return
         const disabledReason = actionDisabledReason(action)
         if (disabledReason) {
            ui.notifications.warn(disabledReason)
            return
         }
         const active = AmmunitionManager.getActiveLoadedPiece(vehicle, action)
         const usesCharges = !!active?.usesCharges
         const amt = usesCharges ? null : await prompt(action, "unload")
         if (!usesCharges && amt === null) return
         await AmmunitionManager.unloadStrike(vehicle, action, amt)
         app.render(false)
      })
   }



   static _bindAmmoListeners(app, invTab) {
      const getTypes = () => [
         ...(app.document.getFlag(MODULE_ID, "ammunitionTypes") || []),
      ]
      const saveTypes = async (data) => {
         await app.document.setFlag(MODULE_ID, "ammunitionTypes", data)
         app.render(false)
      }

      invTab.find(".add-ammo-type").on("click", async (e) => {
         e.preventDefault()
         const types = getTypes()
         types.push({ name: "", slug: "", img: "" })
         await saveTypes(types)
      })

      invTab.find(".remove-ammo-type").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("Ammunition.RemoveTitle") },
            content: `<p>${tKey("Ammunition.RemoveConfirm")}</p>`,
            rejectClose: false,
         })
         if (!confirmed) return

         const index = $(e.currentTarget)
            .closest(".ammo-type-row")
            .data("index")
         const types = getTypes()
         types.splice(index, 1)
         await saveTypes(types)
      })

invTab.find(".ammo-type-icon").on("click", (e) => {
         e.preventDefault()
         const index = Number($(e.currentTarget).data("index"))
         const types = getTypes()
         const FP =
            foundry.applications?.apps?.FilePicker?.implementation ||
            globalThis.FilePicker
         const fp = new FP({
            type: "image",
            current: types[index]?.img || "",
            callback: async (path) => {
               const t = getTypes()
               if (!t[index]) return
               t[index].img = path
               await saveTypes(t)
            },
         })
         fp.render(true)
      })

      invTab.find(".ammo-type-name").on("input", (e) => {
         const row = $(e.currentTarget).closest(".ammo-type-row")
         const slugInput = row.find(".ammo-type-slug")
         const currentSlug = (slugInput.val() || "").trim()
         const previousName = e.currentTarget.dataset.lastValue ?? ""
         const previousAutoSlug = slugify(previousName)
         if (currentSlug === "" || currentSlug === previousAutoSlug)
            slugInput.val(slugify(e.currentTarget.value))
         e.currentTarget.dataset.lastValue = e.currentTarget.value
      })

      invTab
         .find(".ammo-type-name, .ammo-type-slug")
         .on("change", async (e) => {
            e.preventDefault()
            const row = $(e.currentTarget).closest(".ammo-type-row")
            const index = row.data("index")
            const types = getTypes()
            if (!types[index]) return
            types[index] = {
               ...types[index],
               name: row.find(".ammo-type-name").val(),
               slug: row.find(".ammo-type-slug").val(),
            }
            await saveTypes(types)
         })

      const readDropData = (event) => {
         try {
            const data =
               foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData?.(
                  event,
               )
            if (data) return data
         } catch {
            
         }
         const tryParse = (raw) => {
            if (!raw) return null
            try {
               return JSON.parse(raw)
            } catch {
               return null
            }
         }
         return (
            tryParse(event.dataTransfer.getData("text/plain")) ||
            tryParse(event.dataTransfer.getData("text/json")) ||
            tryParse(event.dataTransfer.getData("application/json"))
         )
      }

      const resolveDroppedItem = async (data) => {
         if (!data || data.type !== "Item") return null
         if (data.uuid || data.documentUuid)
            return fromUuid(data.uuid || data.documentUuid)
         if (data.id) {
            const worldItem = game.items.get(data.id)
            if (worldItem) return worldItem
            const actor = data.actorId ? game.actors.get(data.actorId) : null
            if (actor) return actor.items.get(data.id) || null
         }
         return null
      }

const dropZone = invTab.find(".siege-ammo-types-dropzone").get(0)
      if (dropZone) {
         dropZone.addEventListener("dragover", (e) => {
            e.preventDefault()
            e.stopPropagation()
            dropZone.classList.add("siege-ammo-dragover")
         })
         dropZone.addEventListener("dragleave", () =>
            dropZone.classList.remove("siege-ammo-dragover"),
         )
         dropZone.addEventListener("drop", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation?.()
            dropZone.classList.remove("siege-ammo-dragover")
            const data = readDropData(e)
            const item = await resolveDroppedItem(data)
            if (!item) return
            
            const { AmmunitionManager } = await import(
               "../../managers/ammunition.mjs"
            )
            if (!AmmunitionManager.isAmmoItem(item)) {
               ui.notifications.warn(tKey("Ammunition.NotAmmo"))
               return
            }
            const slug = item.system?.slug || slugify(item.name)
            const types = getTypes()
            if (types.some((t) => slugify(t.slug || t.name) === slugify(slug))) {
               ui.notifications.info(tKey("Ammunition.AlreadyExists"))
               return
            }
            types.push({ name: item.name, slug, img: item.img || "" })
            await saveTypes(types)
            ui.notifications.info(
               tKey("Ammunition.Created", { name: item.name }),
            )
         })
      }
   }
}

export const sheetAmmunitionMethods = staticMethods(SheetAmmunitionMixin)
