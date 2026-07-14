import {
   MODULE_ID,
   PF2E_DAMAGE_TYPES,
   DAMAGE_CATEGORIES,
   AREA_TYPES,
   DIE_SIZES,
} from "../constants.mjs"
import { renderHbs, tplPath, capitalize, slugify, tKey } from "../utils.mjs"

const DEFAULT_DAMAGE_PART = {
   dice: 1,
   die: "d6",
   type: "bludgeoning",
   category: "normal",
}

const FALLBACK_MATERIALS = [
   "abysium",
   "adamantine",
   "cold-iron",
   "darkwood",
   "dawnsilver",
   "djezet",
   "dragonhide",
   "grisantian-pelt",
   "mithral",
   "noqual",
   "orichalcum",
   "peachwood",
   "siccatite",
   "silver",
   "sovereign-steel",
   "warpglass",
]

export const DEFAULT_AMMO_SIEGE_FLAGS = {
   damageInfluence: "modify",
   damageParts: [],
   modifyRange: false,
   isRanged: true,
   blindRange: "",
   minRange: "",
   rangeIncrement: "",
   maxRange: "",
   attackBonus: 0,
   rollOptions: "",
   rewriteRollOptions: false,
   traits: "",
   rewriteTraits: false,
   material: "",
   modifySaveDC: false,
   saveDCPaths: [],
   modifyArea: false,
   areaSize: 5,
   areaType: "burst",
}

export class AmmoSiegeUI {
   static renderSheetTab(app, html, data, item) {
      html.find(".siege-ammo-nav-item").remove()
      html.find(".siege-ammo-tab").remove()

      if (app._siegeAmmoTab === undefined)
         app._siegeAmmoTab = app._tabs?.[0]?.active ?? "description"

      html.on("click", ".sheet-navigation .item, .tabs [data-tab]", (ev) => {
         app._siegeAmmoTab = $(ev.currentTarget).data("tab")
         if (app._tabs?.[0]) app._tabs[0].active = app._siegeAmmoTab
      })

      const flags = this.normalizeFlags(item.getFlag(MODULE_ID, "siegeAmmo") || {})
      const templateData = this._buildTemplateData(flags)

      renderHbs(tplPath("sheet/ammo-tab.hbs"), templateData).then((tabHtml) => {
         const tabNav = html.find(".sheet-navigation .item, .tabs [data-tab]").last()
         tabNav.after(
            `<a class="item siege-ammo-nav-item" data-tab="siege" data-tooltip="${tKey("Tabs.EnginesOfWar")}"><i class="fa-solid fa-steering-wheel"></i></a>`,
         )
         html.find(".sheet-body, .tab-body").first().append(tabHtml)

         try {
            app._tabs?.[0]?.bind(html[0])
         } catch (_e) {}

         if (app._siegeAmmoTab === "siege") {
            if (app._tabs?.[0]) app._tabs[0].active = "siege"
            html.find(".sheet-navigation .item, .tabs [data-tab]").removeClass("active")
            html.find(".siege-ammo-nav-item").addClass("active")
            html.find(".sheet-body .tab, .tab-body .tab").removeClass("active")
            html.find(".siege-ammo-tab").addClass("active")
         }

         this._restoreScroll(app, html)

         this.bindListeners(app, item, html, flags)
      })
   }

   static normalizeFlags(raw = {}) {
      return {
         ...DEFAULT_AMMO_SIEGE_FLAGS,
         ...raw,
         damageInfluence: raw.damageInfluence === "rewrite" ? "rewrite" : "modify",
         damageParts: Array.isArray(raw.damageParts) ? raw.damageParts : [],
         saveDCPaths: Array.isArray(raw.saveDCPaths) ? raw.saveDCPaths : [],
         modifyRange: raw.modifyRange === true,
         modifySaveDC: raw.modifySaveDC === true,
         modifyArea: raw.modifyArea === true,
         isRanged: raw.isRanged !== false,
         attackBonus: raw.attackBonus ?? 0,
         rollOptions: raw.rollOptions || "",
         rewriteRollOptions: raw.rewriteRollOptions === true,
         traits: raw.traits || "",
         rewriteTraits: raw.rewriteTraits === true,
         material: slugify(raw.material || ""),
      }
   }

   static _materialOptions(selected = "") {
      const selectedSlug = slugify(selected)
      const config =
         CONFIG?.PF2E?.preciousMaterials ||
         CONFIG?.PF2E?.materials?.precious ||
         CONFIG?.PF2E?.materials ||
         {}
      const entries = Array.isArray(config)
         ? config.map((value) => [slugify(value), String(value)])
         : Object.entries(config).map(([key, value]) => {
              const label =
                 typeof value === "string"
                    ? game.i18n.localize(value)
                    : value?.label
                      ? game.i18n.localize(value.label)
                      : value?.name
                        ? game.i18n.localize(value.name)
                        : key
              return [slugify(key), label]
           })
      const fallback = FALLBACK_MATERIALS.map((m) => [
         m,
         capitalize(m.replace(/-/g, " ")),
      ])
      const seen = new Set()
      const options = [
         { value: "", label: tKey("Misc.None"), selected: !selectedSlug },
      ]
      for (const [value, label] of entries.length ? entries : fallback) {
         if (!value || seen.has(value)) continue
         seen.add(value)
         options.push({ value, label, selected: value === selectedSlug })
      }
      return options.sort((a, b) =>
         a.value === "" ? -1 : b.value === "" ? 1 : a.label.localeCompare(b.label),
      )
   }

   static _buildTemplateData(flags) {
      const enrichedDamageParts = flags.damageParts.map((dp, i) => ({
         ...dp,
         index: i,
         dieOptions: DIE_SIZES.map((d) => ({
            value: d,
            selected: d === dp.die,
         })),
         typeOptions: PF2E_DAMAGE_TYPES.map((t) => ({
            value: t,
            label: capitalize(t),
            selected: t === dp.type,
         })),
         categoryOptions: DAMAGE_CATEGORIES.map((c) => ({
            value: c,
            label: capitalize(c),
            selected: c === dp.category,
         })),
      }))

      return {
         flags,
         damageModifySelected: flags.damageInfluence !== "rewrite",
         damageRewriteSelected: flags.damageInfluence === "rewrite",
         enrichedDamageParts,
         areaTypeOptions: AREA_TYPES.map((t) => ({
            value: t,
            selected: flags.areaType === t,
         })),
         materialOptions: this._materialOptions(flags.material),
         saveDCPresets: [
            { value: "@skills.athletics.dc.value", label: "Athletics DC" },
            { value: "@skills.crafting.dc.value", label: "Crafting DC" },
            {
               value: "@skills.combat-vehicles-lore.dc.value",
               label: "Combat Vehicles Lore DC",
            },
            { value: "@skills.artillery-lore.dc.value", label: "Artillery Lore DC" },
            { value: "@attributes.classDC.value", label: "Class DC" },
         ],
         i18n: {
            damageInfluence: tKey("AmmoTab.DamageInfluence"),
            modifyDamage: tKey("AmmoTab.ModifyDamage"),
            rewriteDamage: tKey("AmmoTab.RewriteDamage"),
            damageInstances: tKey("ActionTab.DamageInstances"),
            addDamageInstance: tKey("ActionTab.AddDamageInstance"),
            modifyRange: tKey("AmmoTab.ModifyRange"),
            isRangedAttack: tKey("ActionTab.IsRangedAttack"),
            blindRange: tKey("ActionTab.BlindRange"),
            minRangeVolley: tKey("ActionTab.MinRangeVolley"),
            rangeIncrement: tKey("ActionTab.RangeIncrement"),
            maxRange: tKey("ActionTab.MaxRange"),
            strikeAttackBonus: tKey("ActionTab.StrikeAttackBonus"),
            rollOptions: tKey("ActionTab.RollOptions"),
            traits: tKey("ActionTab.Traits"),
            rewrite: tKey("AmmoTab.Rewrite"),
            material: tKey("AmmoTab.Material"),
            modifySaveDC: tKey("AmmoTab.ModifySaveDC"),
            saveDC: tKey("ActionTab.SaveDC"),
            addAnother: tKey("ActionTab.AddAnother"),
            modifyArea: tKey("AmmoTab.ModifyArea"),
            areaFeet: tKey("ActionTab.AreaFeet"),
         },
      }
   }

   static _scrollCandidates(app, html) {
      const root =
         app.element instanceof HTMLElement
            ? app.element
            : app.element?.[0] || html?.[0] || null
      const found = [
         html.closest(".window-content")[0],
         root?.querySelector?.(".window-content"),
         root?.querySelector?.(".sheet-content"),
         html.find(".sheet-body")[0],
         root?.querySelector?.(".sheet-body"),
         html.find(".tab.active")[0],
         root?.querySelector?.(".tab.active"),
         html.find('.tab[data-tab="siege"]')[0],
         root?.querySelector?.('.tab[data-tab="siege"]'),
         html.find(".siege-ammo-tab")[0],
         root?.querySelector?.(".siege-ammo-tab"),
         html[0],
      ].filter(Boolean)
      return [...new Set(found)].filter(
         (el) => typeof el.scrollTop === "number",
      )
   }

   static _captureScroll(app, html) {
      const candidates = this._scrollCandidates(app, html)
      app._siegeAmmoScrollPos = Math.max(
         0,
         ...candidates.map((el) => Number(el.scrollTop) || 0),
      )
   }

   static _restoreScroll(app, html) {
      if (app._siegeAmmoScrollPos == null) return
      const restore = () => {
         for (const el of this._scrollCandidates(app, html))
            el.scrollTop = app._siegeAmmoScrollPos
      }
      restore()
      requestAnimationFrame(restore)
      setTimeout(restore, 0)
      setTimeout(restore, 100)
   }

   static bindListeners(app, item, html, flags) {
      const saveFlags = async (render = false) => {
         await item.update(
            { [`flags.${MODULE_ID}.siegeAmmo`]: flags },
            render ? {} : { render: false },
         )
      }
      const saveWithRender = async () => {
         this._captureScroll(app, html)
         await item.update({ [`flags.${MODULE_ID}.siegeAmmo`]: flags })
      }
      const setSectionVisible = (selector, visible) =>
         html.find(selector).css("display", visible ? "" : "none")

      html.find("[data-ammo-path]").on("change", async (e) => {
         const el = e.currentTarget
         const path = el.dataset.ammoPath
         if (el.type === "checkbox") flags[path] = el.checked
         else if (el.type === "number") flags[path] = el.value === "" ? "" : Number(el.value)
         else flags[path] = el.value
         await saveFlags()
      })

      html.find(".ammo-modify-range-cb").on("change", (e) => {
         setSectionVisible(".ammo-range-settings", e.target.checked)
      })
      html.find(".ammo-is-ranged-cb").on("change", (e) => {
         setSectionVisible(".ammo-ranged-fields", e.target.checked)
      })
      html.find(".ammo-modify-savedc-cb").on("change", (e) => {
         setSectionVisible(".ammo-savedc-settings", e.target.checked)
      })
      html.find(".ammo-modify-area-cb").on("change", (e) => {
         setSectionVisible(".ammo-area-settings", e.target.checked)
      })

      html.find(".add-ammo-damage-part").on("click", async (e) => {
         e.preventDefault()
         flags.damageParts.push({ ...DEFAULT_DAMAGE_PART })
         await saveWithRender()
      })

      html.find(".remove-ammo-damage-part").on("click", async (e) => {
         e.preventDefault()
         const idx = $(e.currentTarget).closest(".damage-part-row").data("index")
         flags.damageParts.splice(idx, 1)
         await saveWithRender()
      })

      html
         .find(".ammo-dp-dice, .ammo-dp-die, .ammo-dp-type, .ammo-dp-category")
         .on("change", async (e) => {
            const row = $(e.currentTarget).closest(".damage-part-row")
            const idx = row.data("index")
            flags.damageParts[idx] = {
               dice: parseInt(row.find(".ammo-dp-dice").val()) || 0,
               die: row.find(".ammo-dp-die").val(),
               type: row.find(".ammo-dp-type").val(),
               category: row.find(".ammo-dp-category").val(),
            }
            await saveFlags()
         })

      html.find(".add-ammo-savedc-path").on("click", async (e) => {
         e.preventDefault()
         const input = $(e.currentTarget).siblings(".ammo-savedc-input")
         const val = String(input.val() || "").trim()
         if (!val) return
         flags.saveDCPaths = flags.saveDCPaths || []
         flags.saveDCPaths.push(val)
         await saveWithRender()
      })

      html.find(".ammo-savedc-input").on("keydown", async (e) => {
         if (e.key !== "Enter") return
         e.preventDefault()
         const val = String($(e.currentTarget).val() || "").trim()
         if (!val) return
         flags.saveDCPaths = flags.saveDCPaths || []
         flags.saveDCPaths.push(val)
         await saveWithRender()
      })

      html.find(".remove-ammo-savedc-path").on("click", async (e) => {
         e.preventDefault()
         const idx = $(e.currentTarget).data("index")
         flags.saveDCPaths = flags.saveDCPaths || []
         flags.saveDCPaths.splice(idx, 1)
         await saveWithRender()
      })
   }
}
