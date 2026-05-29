import { MODULE_ID, DC_BY_LEVEL, D20_SVG } from "../constants.mjs"
import { clampLevel, isSiege, tKey } from "../utils.mjs"
import { SiegeSFXManager } from "../managers/sfx.mjs"

export class SiegeSheetUI {
   static renderSheet(app, html, data) {
      if (app.document.type !== "vehicle") return
      const isSiegeWeapon = isSiege(app.document)
      this._injectToggle(app, html, isSiegeWeapon)
      if (isSiegeWeapon) {
         this._transformToSiegeWeapon(app, html)
         SiegeSFXManager.buildTabUI(app, html)
      }
   }

   static _injectToggle(app, html, isSiegeWeapon) {
      if (html.find(".siege-weapon-toggle").length === 0) {
         html.find(".vehicle-properties").append(`
            <div class="detailsInput flexitem-full siege-weapon-toggle">
               <input type="checkbox" id="siege-toggle-${app.document.id}" class="siege-convert-checkbox siege-checkbox" ${isSiegeWeapon ? "checked" : ""}>
               <label for="siege-toggle-${app.document.id}" class="siege-checkbox-label">${tKey("Sheet.ConvertToSiege")}</label>
            </div>
         `)
         html.find(".siege-convert-checkbox").on("change", async (e) => {
            await app.document.update({
               [`flags.${MODULE_ID}.isSiegeWeapon`]: e.target.checked,
            })
         })
      }

      if (isSiegeWeapon && html.find(".siege-mountable-toggle").length === 0) {
         const isMountable =
            app.document.getFlag(MODULE_ID, "mountableByPCs") !== false
         html.find(".vehicle-properties").append(`
            <div class="detailsInput flexitem-full siege-mountable-toggle">
               <input type="checkbox" id="siege-mountable-${app.document.id}" class="siege-mountable-checkbox siege-checkbox" ${isMountable ? "checked" : ""}>
               <label for="siege-mountable-${app.document.id}" class="siege-checkbox-label siege-checkbox-label-normal">${tKey("Sheet.MountableByPCs")}</label>
            </div>
         `)
         html.find(".siege-mountable-checkbox").on("change", async (e) => {
            await app.document.update({
               [`flags.${MODULE_ID}.mountableByPCs`]: e.target.checked,
            })
         })
      }
   }

   static _transformToSiegeWeapon(app, html) {
      html.find(".char-level .level label").text(tKey("Sheet.ItemLabel"))
      this._injectSaves(app, html)
      this._transformInventoryToAmmunition(app, html)
      this._cleanActionsTab(app, html)
      this._injectBulk(app, html)
      this._cleanVehicleProperties(html)
      this._injectCustomTabs(app, html)
   }

   static _transformInventoryToAmmunition(app, html) {
      const navInv = html.find('.sheet-navigation a[data-tab="inventory"]')
      if (navInv.length > 0) {
         navInv.attr("data-tooltip", tKey("Tabs.Ammunition"))
         navInv.html('<i class="fa-solid fa-cannon"></i>')
      }

      const invTab = html.find(".tab.inventory")
      if (invTab.length === 0) return

      invTab.find(".coinage, .inventory-header, .total-bulk").remove()
      invTab.find(".inventory-list header").each(function () {
         if ($(this).find(".item-name").text().trim() !== "Ammunition") {
            $(this).next(".items").remove()
            $(this).remove()
         }
      })

      const ammoTypes = app.document.getFlag(MODULE_ID, "ammunitionTypes") || []
      const labelName = tKey("Ammunition.Name")
      const labelSlug = tKey("Ammunition.Slug")
      const labelMax = tKey("Ammunition.Max")
      const phName = tKey("Ammunition.Name")
      const phSlug = tKey("Ammunition.Slug")
      const phMax = tKey("Ammunition.MaxPlaceholder")
      const titleMax = tKey("Ammunition.MaxTooltip")

      const typesListHtml = ammoTypes
         .map(
            (type, index) => `
         <li class="item ammo-type-row" data-index="${index}">
            <div class="crew-list-headers">
               <span class="crew-col-2">${labelName}</span>
               <span class="crew-col-2">${labelSlug}</span>
               <span class="crew-col-1">${labelMax}</span>
               <span class="crew-col-icon"></span>
            </div>
            <div class="ammo-inputs">
               <input type="text" class="ammo-input-text ammo-type-name" placeholder="${phName}" value="${type.name}">
               <input type="text" class="ammo-input-text ammo-type-slug" placeholder="${phSlug}" value="${type.slug}">
               <input type="text" class="ammo-input-num ammo-type-max" placeholder="${phMax}" value="${type.max}" title="${titleMax}">
               <a class="remove-ammo-type crew-col-icon"><i class="fa-solid fa-trash"></i></a>
            </div>
         </li>
      `,
         )
         .join("")

      if (invTab.find(".siege-ammo-types").length === 0) {
         invTab.prepend(`
            <div class="siege-ammo-types">
               <header class="siege-header-alt">
                  <h3>${tKey("Ammunition.TypesHeader")}</h3>
                  <a class="add-ammo-type"><i class="fa-solid fa-plus"></i></a>
               </header>
               <ul class="items">${typesListHtml}</ul>
            </div>
         `)
      }

      this._bindAmmoListeners(app, invTab)
   }

   static _bindAmmoListeners(app, invTab) {
      const getTypes = () => [
         ...(app.document.getFlag(MODULE_ID, "ammunitionTypes") || []),
      ]
      const saveTypes = (data) =>
         app.document.setFlag(MODULE_ID, "ammunitionTypes", data)

      invTab.find(".add-ammo-type").on("click", async (e) => {
         e.preventDefault()
         const types = getTypes()
         types.push({ name: "", slug: "", max: "" })
         await saveTypes(types)
      })

      invTab.find(".remove-ammo-type").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: tKey("Ammunition.RemoveTitle") },
            content: `<p>${tKey("Ammunition.RemoveConfirm")}</p>`,
            rejectClose: false,
         })
         if (!confirmed) return

         const index = $(e.currentTarget).closest(".ammo-type-row").data("index")
         const types = getTypes()
         types.splice(index, 1)
         await saveTypes(types)
      })

      invTab
         .find(".ammo-type-name, .ammo-type-slug, .ammo-type-max")
         .on("change", async (e) => {
            e.preventDefault()
            const row = $(e.currentTarget).closest(".ammo-type-row")
            const index = row.data("index")
            const types = getTypes()
            types[index] = {
               name: row.find(".ammo-type-name").val(),
               slug: row.find(".ammo-type-slug").val(),
               max: row.find(".ammo-type-max").val(),
            }
            await saveTypes(types)
         })
   }

   static _cleanActionsTab(app, html) {
      if (html.find(".siege-attacks-header").length > 0) return
      const actionsTab = html.find(".tab.actions")
      actionsTab.find("header.action-header").each(function () {
         if (
            ["Reactions", "Free Actions"].some((t) =>
               $(this).text().includes(t),
            )
         ) {
            $(this).next("ol").remove()
            $(this).remove()
         }
      })

      const actionsList = actionsTab.find(".actions-panels ol").first()
      const allActions = actionsList.children(".item").detach()

      const attacksLabel = tKey("Sheet.AttacksHeader")
      const actionsLabel = tKey("Sheet.ActionsHeader")
      const createAttack = tKey("Sheet.CreateAttack")
      const createAction = tKey("Sheet.CreateAction")

      actionsTab.find(".actions-panels").empty().append(`
            <header class="action-header siege-attacks-header">${attacksLabel}
                <div class="controls"><button type="button" class="add-siege-action" data-attack="true"><i class="fa-solid fa-fw fa-plus"></i>${createAttack}</button></div>
            </header>
            <ol class="actions-list siege-attacks-list"></ol>
            <header class="action-header siege-actions-header">${actionsLabel}
                <div class="controls"><button type="button" class="add-siege-action" data-attack="false"><i class="fa-solid fa-fw fa-plus"></i>${createAction}</button></div>
            </header>
            <ol class="actions-list siege-regular-actions-list"></ol>
      `)

      const attacksListDOM = actionsTab.find(".siege-attacks-list")
      const actionsListDOM = actionsTab.find(".siege-regular-actions-list")
      const postLabel = tKey("Buttons.PostToChat")

      allActions.each(function () {
         const itemId = $(this).attr("data-item-id")
         const item = app.document.items.get(itemId)
         const flag = item?.getFlag(MODULE_ID, "siegeAction")

         const controls = $(this).find(".item-controls")
         controls.prepend(
            `<a class="item-control siege-manual-roll" title="${postLabel}"><i class="fa-solid fa-message"></i></a>`,
         )

         if (flag?.isAttack || flag?.isStrike) attacksListDOM.append(this)
         else actionsListDOM.append(this)
      })

      html.find(".siege-manual-roll").on("click", async (e) => {
         e.preventDefault()
         const itemId = $(e.currentTarget).closest(".item").data("item-id")
         const item = app.document.items.get(itemId)
         if (item) item.toMessage(e)
      })

      html.find(".add-siege-action").on("click", (e) => {
         e.preventDefault()
         const isAttack = $(e.currentTarget).data("attack")
         import("../managers/actions.mjs").then((m) =>
            m.SiegeActionsManager.showBuilderDialog(app.document, isAttack),
         )
      })
   }

   static _injectSaves(app, html) {
      if (html.find(".sidebar-saves").find('[data-save="reflex"]').length > 0)
         return

      const refVal = app.document.getFlag(MODULE_ID, "saves.reflex.value") || 0
      const willVal = app.document.getFlag(MODULE_ID, "saves.will.value") || 0

      const refLabel = tKey("Attributes.Reflex")
      const willLabel = tKey("Attributes.Will")

      html.find(".sidebar-saves").append(`
         <li class="roll-data" data-save="reflex">
            <h2 class="sidebar_label">${refLabel}</h2>
            <div class="save-roll">
               <a class="roll-icon custom-siege-save" data-save="reflex">
                  <div class="d20-svg">${D20_SVG}</div>
               </a>
               <input class="adjustable" name="flags.${MODULE_ID}.saves.reflex.value" type="number" value="${refVal}">
            </div>
         </li>
         <li class="roll-data" data-save="will">
            <h2 class="sidebar_label">${willLabel}</h2>
            <div class="save-roll">
               <a class="roll-icon custom-siege-save" data-save="will">
                  <div class="d20-svg">${D20_SVG}</div>
               </a>
               <input class="adjustable" name="flags.${MODULE_ID}.saves.will.value" type="number" value="${willVal}">
            </div>
         </li>
      `)

      html.find(".custom-siege-save").on("click", async (e) => {
         e.preventDefault()
         const saveType = $(e.currentTarget).data("save")
         const mod =
            parseInt(
               app.document.getFlag(MODULE_ID, `saves.${saveType}.value`),
            ) || 0
         const label =
            saveType === "reflex"
               ? tKey("Attributes.Reflex")
               : tKey("Attributes.Will")
         const title = tKey("Saves.Title", { name: label })

         try {
            const modifiers = [
               new game.pf2e.Modifier({
                  slug: "base",
                  label: tKey("Modifiers.Base"),
                  modifier: mod,
                  type: "untyped",
               }),
            ]
            const checkMod = new game.pf2e.StatisticModifier(title, modifiers)
            game.pf2e.Check.roll(
               checkMod,
               { actor: app.document, type: "saving-throw", options: [] },
               e.originalEvent ?? e,
            )
         } catch (err) {
            const roll = new Roll(`1d20 + ${mod}`)
            await roll.evaluate()
            roll.toMessage({
               speaker: ChatMessage.getSpeaker({ actor: app.document }),
               flavor: `<h4 class="action"><strong>${title}</strong></h4>`,
            })
         }
      })
   }

   static _injectBulk(app, html) {
      const speedInput = html.find('input[name="system.details.speed"]')
      const speedRow = speedInput.closest(".row-nr-2")
      const traits = app.document.system.traits?.value || []
      const isPortable = traits.includes("portable")

      if (
         speedRow.length === 0 ||
         html.find(`input[name="flags.${MODULE_ID}.disableDC"]`).length > 0
      ) {
         this._toggleBulkColumn(app, speedRow, isPortable)
         return
      }

      speedRow.removeClass("span-2-columns").addClass("siege-bulk-row")
      const rowTitle = speedRow.attr("title")
      if (rowTitle) speedRow.removeAttr("title")

      const speedLabel = speedRow.find('label[for*="speed"]')
      const speedWrapper = $('<div class="siege-bulk-col"></div>')
      if (rowTitle) speedWrapper.attr("title", rowTitle)
      speedLabel.add(speedInput).wrapAll(speedWrapper)

      const siegeLevel = clampLevel(app.document.system.details.level?.value)
      const disableDC =
         app.document.getFlag(MODULE_ID, "disableDC") || DC_BY_LEVEL[siegeLevel]

      const bulkHtml = isPortable
         ? this._buildBulkColumnHTML(app)
         : ""

      speedRow.append(`
         ${bulkHtml}
         <div class="siege-bulk-col">
            <label class="details-label">${tKey("Attributes.DisableDC")}</label>
            <input class="details-input" name="flags.${MODULE_ID}.disableDC" type="number" value="${disableDC}">
         </div>
      `)
   }

   static _toggleBulkColumn(app, speedRow, isPortable) {
      if (speedRow.length === 0) return
      const existingBulk = speedRow.find(".siege-portable-bulk")
      if (isPortable && existingBulk.length === 0) {
         const disableDCCol = speedRow
            .find(`input[name="flags.${MODULE_ID}.disableDC"]`)
            .closest(".siege-bulk-col")
         disableDCCol.before(this._buildBulkColumnHTML(app))
      } else if (!isPortable && existingBulk.length > 0) {
         existingBulk.remove()
      }
   }

   static _buildBulkColumnHTML(app) {
      const bulkLabel = tKey("Attributes.Bulk")
      const bulkTooltip = tKey("Sheet.BulkTooltip")
      const bulkValue = app.document.getFlag(MODULE_ID, "bulk") || 0
      return `
         <div class="siege-bulk-col siege-portable-bulk">
            <label class="details-label siege-bulk-label">
               ${bulkLabel}
               <i class="fa-solid fa-circle-info" data-tooltip="${bulkTooltip}" data-tooltip-direction="UP"></i>
            </label>
            <input class="details-input" name="flags.${MODULE_ID}.bulk" type="number" value="${bulkValue}">
         </div>`
   }

   static _cleanVehicleProperties(html) {
      html.find(".vehicle-properties .detailsInput").each(function () {
         if (
            !$(this).hasClass("siege-weapon-toggle") &&
            !$(this).hasClass("siege-mountable-toggle") &&
            $(this).find(".details-label").text().trim() !== "Traits"
         )
            $(this).remove()
      })
   }

   static _injectCustomTabs(app, html) {
      if (app._siegeActiveTab === undefined) {
         app._siegeActiveTab = app._tabs?.[0]?.active ?? "description"
      }

      html.on("click", "nav .item, nav [data-tab]", (ev) => {
         app._siegeActiveTab = $(ev.currentTarget).data("tab")
      })

      if (html.find('a[data-tab="crew"]').length === 0) {
         html
            .find('a[data-tab="description"]')
            .before(
               `<a class="item" data-tab="crew"><i class="fa-solid fa-users"></i></a><a class="item" data-tab="sfx"><i class="fa-solid fa-music"></i></a>`,
            )
         html
            .find(".sheet-content")
            .append(
               `<div class="tab crew" data-tab="crew"><h2>${tKey("Crew.Title")}</h2></div><div class="tab sfx" data-tab="sfx"><h2>${tKey("SFX.GlobalHeader")}</h2></div>`,
            )
      }

      if (["crew", "sfx", "ammunition"].includes(app._siegeActiveTab)) {
         html.find(".tab, a.item[data-tab]").removeClass("active")
         html.find(`[data-tab="${app._siegeActiveTab}"]`).addClass("active")
      }
   }
}
