import {
   MODULE_ID,
   DEFAULT_SIEGE_ACTION_FLAGS,
   PF2E_SKILLS,
   PF2E_DAMAGE_TYPES,
   DAMAGE_CATEGORIES,
   AREA_TYPES,
   DIE_SIZES,
} from "../constants.mjs"
import { renderHbs, tplPath, capitalize, slugify, splitCSV, tKey } from "../utils.mjs"
import { SiegeSettings } from "../managers/settings.mjs"
import { moduleTabListenerMethods } from "./module-tab/listeners.mjs"

const DEFAULT_DAMAGE_PART = {
   dice: 1,
   die: "d6",
   type: "bludgeoning",
   category: "normal",
}

const ACTION_TYPE_OPTIONS = [
   { value: "area-fire", labelKey: "ActionTab.AreaFire" },
   { value: "auto-fire", labelKey: "ActionTab.AutoFire" },
   { value: "save-single", labelKey: "ActionTab.SingleTarget" },
]

const DEFAULT_MODULE_FLAGS = {
   isModule: false,
   moduleType: "vehicle",
   installType: "",
   vehicleNames: "",
   craftingDC: "",
   entries: [],
   modifications: [],
}

const DEFAULT_SHIELD_ENTRY = {
   type: "shield",
   name: "",
   img: "",
   acBonus: 2,
   hp: 20,
   hardness: 0,
   speedPenalty: 0,
}

const DEFAULT_LIGHT_ENTRY = {
   type: "light",
   name: "",
   img: "",
   light: {
      config: {
         dim: 10,
         bright: 5,
      },
   },
}

const DEFAULT_ACTION_ENTRY = {
   type: "action",
   actionKind: "strike",
   name: "",
   img: "",
   description: "",
   actions: 1,
   usesAmmunition: true,
   ammoSlugs: "",
   ammoTypes: [],
   maxLoaded: "",
   spend: 1,
   attackBonus: 0,
   rollOptions: "",
   traits: "",
   isRanged: true,
   blindRange: "",
   minRange: "",
   rangeIncrement: 120,
   maxRange: 600,
   actionType: "area-fire",
   areaSize: 5,
   areaType: "burst",
   saveDCPaths: "",
   damageParts: [{ ...DEFAULT_DAMAGE_PART }],
}

const DEFAULT_MODIFICATION = {
   targetSlug: "",
   loadCapacityDelta: 0,
   attackBonusDelta: 0,
   saveDCDelta: 0,
   loadActionsRequiredDelta: 0,
   maxLoadedDelta: 0,
   spendDelta: 0,
   rollOptions: "",
   traits: "",
   modifyRange: false,
   isRanged: true,
   blindRange: "",
   minRange: "",
   rangeIncrement: "",
   maxRange: "",
   modifyArea: false,
   areaSize: 5,
   areaType: "burst",
   prerequisiteName: "",
   prerequisiteDelta: 0,
   skillName: "",
   skillLoreName: "",
   skillDCDelta: 0,
   damageParts: [],
}

export class ModuleItemUI {
   static renderSheetTab(app, html, data, item) {
      if (item.type !== "equipment") return
      html.find(".siege-module-nav-item").remove()
      html.find(".siege-module-tab").remove()

      if (app._siegeModuleTab === undefined)
         app._siegeModuleTab = app._tabs?.[0]?.active ?? "description"

      html.on("click", ".sheet-navigation .item, .tabs [data-tab]", (ev) => {
         app._siegeModuleTab = $(ev.currentTarget).data("tab")
         if (app._tabs?.[0]) app._tabs[0].active = app._siegeModuleTab
      })

      const flags = this.normalizeFlags(item.getFlag(MODULE_ID, "vehicleModule") || {})
      const templateData = this._buildTemplateData(item, flags)

      renderHbs(tplPath("sheet/module-tab.hbs"), templateData).then((tabHtml) => {
         const tabNav = html.find(".sheet-navigation .item, .tabs [data-tab]").last()
         tabNav.after(
            `<a class="item siege-module-nav-item" data-tab="modules" data-tooltip="${tKey("Tabs.Modules")}"><i class="fa-solid fa-kaaba"></i></a>`,
         )
         html.find(".sheet-body, .tab-body").first().append(tabHtml)

         try {
            app._tabs?.[0]?.bind(html[0])
         } catch (_e) {}

         if (app._siegeModuleTab === "modules") {
            if (app._tabs?.[0]) app._tabs[0].active = "modules"
            html.find(".sheet-navigation .item, .tabs [data-tab]").removeClass("active")
            html.find(".siege-module-nav-item").addClass("active")
            html.find(".sheet-body .tab, .tab-body .tab").removeClass("active")
            html.find(".siege-module-tab").addClass("active")
         }

         this._restoreScroll(app, html)

         this.bindListeners(app, item, html, flags)
      })
   }

   static normalizeFlags(raw = {}) {
      const flags = {
         ...DEFAULT_MODULE_FLAGS,
         ...raw,
      }
      flags.isModule = raw.isModule === true
      flags.moduleType = raw.moduleType === "component" ? "component" : "vehicle"
      flags.entries = Array.isArray(raw.entries)
         ? raw.entries.map((entry) => this._normalizeEntry(entry))
         : []
      flags.modifications = Array.isArray(raw.modifications)
         ? raw.modifications.map((mod) => this._normalizeModification(mod))
         : []
      return flags
   }

   static _id(prefix) {
      const id = foundry?.utils?.randomID?.() || Math.random().toString(36).slice(2)
      return `${prefix}-${id}`
   }

   static _normalizeEntry(entry = {}) {
      const type = ["rule", "action", "loadCapacity", "speed", "save", "shield", "light"].includes(
         entry.type,
      )
         ? entry.type
         : "rule"
      const base =
         type === "action"
            ? { ...DEFAULT_ACTION_ENTRY }
            : type === "shield"
              ? { ...DEFAULT_SHIELD_ENTRY }
              : type === "light"
                ? foundry.utils.deepClone(DEFAULT_LIGHT_ENTRY)
              : type === "loadCapacity"
              ? { type, value: 0 }
              : type === "speed"
                ? { type, value: 0 }
                : type === "save"
                  ? { type, save: "reflex", value: 0 }
                  : { type, label: "", json: '{ "key": "" }' }
      const next = {
         ...base,
         ...entry,
         id: entry.id || this._id("entry"),
         type,
      }
      if (type === "action") {
         next.actionKind = next.actionKind === "ability" ? "ability" : "strike"
         next.usesAmmunition = next.usesAmmunition !== false
         next.isRanged = next.isRanged !== false
         next.damageParts =
            Array.isArray(next.damageParts) && next.damageParts.length
               ? next.damageParts
               : [{ ...DEFAULT_DAMAGE_PART }]
         next.ammoTypes = Array.isArray(next.ammoTypes)
            ? next.ammoTypes.map((ammo) => ({
                 name: ammo.name || ammo.slug || "",
                 slug: slugify(ammo.slug || ammo.name),
                 img: ammo.img || "",
              })).filter((ammo) => ammo.slug)
            : []
         if (next.ammoTypes.length === 0 && next.ammoSlugs) {
            next.ammoTypes = splitCSV(next.ammoSlugs).map((slug) => ({
               name: slug,
               slug: slugify(slug),
               img: "",
            })).filter((ammo) => ammo.slug)
         }
      }
      if (type === "shield") {
         next.acBonus = Math.max(0, Number(next.acBonus) || 0)
         next.hp = Math.max(1, Number(next.hp) || 1)
         next.hardness = Math.max(0, Number(next.hardness) || 0)
         next.speedPenalty = Math.max(0, Number(next.speedPenalty) || 0)
      }
      if (type === "light") {
         next.name = String(next.name || "")
         next.img = String(next.img || "")
         next.light = this._normalizeLightData(next.light)
      }
      return next
   }

   static _normalizeLightData(value = {}) {
      const light =
         value && typeof value === "object" && !Array.isArray(value)
            ? foundry.utils.deepClone(value)
            : {}
      light.config =
         light.config && typeof light.config === "object" && !Array.isArray(light.config)
            ? light.config
            : {}
      if (light.config.dim === undefined) light.config.dim = 10
      if (light.config.bright === undefined) light.config.bright = 5
      return light
   }

   static _normalizeModification(mod = {}) {
      return {
         ...DEFAULT_MODIFICATION,
         ...mod,
         id: mod.id || this._id("mod"),
         modifyRange: mod.modifyRange === true,
         isRanged: mod.isRanged !== false,
         modifyArea: mod.modifyArea === true,
         areaSize: mod.areaSize ?? 5,
         areaType: mod.areaType || "burst",
         damageParts: Array.isArray(mod.damageParts) ? mod.damageParts : [],
      }
   }

   static _damagePartData(parts) {
      return (Array.isArray(parts) ? parts : []).map((dp, index) => ({
         ...dp,
         index,
         dieOptions: DIE_SIZES.map((value) => ({
            value,
            selected: value === dp.die,
         })),
         typeOptions: PF2E_DAMAGE_TYPES.map((value) => ({
            value,
            label: capitalize(value),
            selected: value === dp.type,
         })),
         categoryOptions: DAMAGE_CATEGORIES.map((value) => ({
            value,
            label: capitalize(value),
            selected: value === dp.category,
         })),
      }))
   }

   static _buildTemplateData(item, flags) {
      const entries = flags.entries.map((entry) => ({
         ...entry,
         title: this._entryTitle(entry),
         open: this._openSet(item)?.has(entry.id),
         isRule: entry.type === "rule",
         isAction: entry.type === "action",
         isLoadCapacity: entry.type === "loadCapacity",
         isSpeed: entry.type === "speed",
         isSave: entry.type === "save",
         isShield: entry.type === "shield",
         isLight: entry.type === "light",
         lightPreview: this._lightPreviewData(entry),
         reflexSelected: entry.save === "reflex",
         willSelected: entry.save === "will",
         fortitudeSelected: entry.save === "fortitude",
         isStrike: entry.actionKind !== "ability",
         isAbility: entry.actionKind === "ability",
         damagePartsData: this._damagePartData(entry.damageParts),
         actionTypeOptions: ACTION_TYPE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: tKey(opt.labelKey),
            selected: entry.actionType === opt.value,
         })),
         areaTypeOptions: AREA_TYPES.map((value) => ({
            value,
            selected: entry.areaType === value,
         })),
         ammoTypeBadges: (entry.ammoTypes || []).map((ammo) => ({
            ...ammo,
            label: ammo.name || ammo.slug,
         })),
      }))
      const modifications = flags.modifications.map((mod) => ({
         ...mod,
         title: mod.targetSlug || tKey("Modules.Modification"),
         open: this._openSet(item)?.has(mod.id),
         isLore: mod.skillName === "lore",
         skillLoreInput: this._loreInputValue(mod.skillLoreName),
         skillOptions: ["", "lore", ...PF2E_SKILLS].map((skill) => ({
            value: skill,
            label: skill === "" ? tKey("Misc.Select") : skill === "lore" ? tKey("Skills.Lore") : capitalize(skill),
            selected: skill === mod.skillName,
         })),
         damagePartsData: this._damagePartData(mod.damageParts),
         areaTypeOptions: AREA_TYPES.map((value) => ({
            value,
            selected: mod.areaType === value,
         })),
      }))
      return {
         item,
         flags,
         entries,
         modifications,
         addEntryOptions: [
            { type: "rule", kind: "", label: tKey("Modules.AddRule") },
            { type: "action", kind: "strike", label: tKey("Modules.AddStrike") },
            { type: "action", kind: "ability", label: tKey("Modules.AddStrikeAbility") },
            { type: "loadCapacity", kind: "", label: tKey("Modules.AddLoadCapacity") },
            { type: "speed", kind: "", label: tKey("Modules.AddSpeed") },
            { type: "save", kind: "", label: tKey("Modules.AddSavingThrow") },
            { type: "shield", kind: "", label: tKey("Modules.AddShield") },
            { type: "light", kind: "", label: tKey("Modules.AddLight") },
         ],
         vehicleSelected: flags.moduleType !== "component",
         componentSelected: flags.moduleType === "component",
         installTypeOptions: SiegeSettings.moduleTypes().map((type) => ({
            value: type,
            selected: flags.installType === type,
         })),
         i18n: this._i18n(),
      }
   }

   static _openSet(item) {
      item._siegeModuleOpen = item._siegeModuleOpen || new Set()
      return item._siegeModuleOpen
   }

   static _captureOpen(item, html) {
      const open = this._openSet(item)
      html.find(".siege-module-acc").each((_, el) => {
         const id = el.dataset.entryId || el.dataset.modId
         if (!id) return
         if (el.open) open.add(id)
         else open.delete(id)
      })
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
         html.find('.tab[data-tab="modules"]')[0],
         root?.querySelector?.('.tab[data-tab="modules"]'),
         html.find(".siege-module-tab")[0],
         root?.querySelector?.(".siege-module-tab"),
         html[0],
      ].filter(Boolean)
      return [...new Set(found)].filter(
         (el) => typeof el.scrollTop === "number",
      )
   }

   static _captureScroll(app, html) {
      const candidates = this._scrollCandidates(app, html)
      app._siegeModuleScrollPos = Math.max(
         0,
         ...candidates.map((el) => Number(el.scrollTop) || 0),
      )
   }

   static _restoreScroll(app, html) {
      if (app._siegeModuleScrollPos == null) return
      const restore = () => {
         for (const el of this._scrollCandidates(app, html))
            el.scrollTop = app._siegeModuleScrollPos
      }
      restore()
      requestAnimationFrame(restore)
      setTimeout(restore, 0)
      setTimeout(restore, 100)
   }

   static _normalizeLoreName(value) {
      const raw = String(value || "")
         .trim()
         .replace(/\s+lore$/i, "")
         .replace(/-lore$/i, "")
      const base = slugify(raw)
      return base ? `${base}-lore` : ""
   }

   static _loreInputValue(value) {
      return String(value || "")
         .replace(/-lore$/i, "")
         .replace(/-/g, " ")
         .trim()
         .split(/\s+/)
         .filter(Boolean)
         .map((word) => capitalize(word))
         .join(" ")
   }

   static _entryTitle(entry) {
      if (entry.type === "action")
         return entry.name || tKey(entry.actionKind === "ability" ? "Modules.StrikeAbility" : "Modules.Strike")
      if (entry.type === "loadCapacity") return tKey("Modules.LoadCapacity")
      if (entry.type === "speed") return tKey("Modules.Speed")
      if (entry.type === "save") return tKey("Modules.SavingThrow")
      if (entry.type === "shield")
         return entry.name || tKey("Modules.Shield")
      if (entry.type === "light")
         return entry.name || tKey("Modules.Light")
      return entry.label || tKey("Modules.RuleElement")
   }

   static _lightPreviewData(entry) {
      const config = entry.light?.config || {}
      const dim = Math.max(0, Number(config.dim) || 0)
      const bright = Math.max(0, Number(config.bright) || 0)
      const rawColor = String(config.color || "#ffffff")
      const color = /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#ffffff"
      const hasLight = dim > 0 || bright > 0
      return {
         color: hasLight ? color : "transparent",
         icon: hasLight ? "fa-lightbulb" : "fa-lightbulb-slash",
         label: tKey(hasLight ? "Modules.ReconfigureLight" : "Modules.ConfigureLight"),
         summary: tKey("Modules.LightSummary", { dim, bright }),
      }
   }

   static _i18n() {
      return {
         isModule: tKey("Modules.IsModule"),
         vehicleNames: tKey("Modules.VehicleNames"),
         vehicleNamesTooltip: tKey("Modules.VehicleNamesTooltip"),
         craftingDC: tKey("Modules.CraftingDC"),
         moduleType: tKey("Modules.ModuleType"),
         installType: tKey("Modules.InstallType"),
         selectInstallType: tKey("Misc.Select"),
         vehicleModule: tKey("Modules.VehicleModule"),
         componentModule: tKey("Modules.ComponentModule"),
         vehicleEntries: tKey("Modules.VehicleEntries"),
         componentEntries: tKey("Modules.ComponentEntries"),
         addRule: tKey("Modules.AddRule"),
         addStrike: tKey("Modules.AddStrike"),
         addStrikeAbility: tKey("Modules.AddStrikeAbility"),
         addLoadCapacity: tKey("Modules.AddLoadCapacity"),
         addSavingThrow: tKey("Modules.AddSavingThrow"),
         addShield: tKey("Modules.AddShield"),
         addLight: tKey("Modules.AddLight"),
         shield: tKey("Modules.Shield"),
         light: tKey("Modules.Light"),
         lightConfiguration: tKey("Modules.LightConfiguration"),
         acBonus: tKey("Modules.AcBonus"),
         hardness: tKey("Modules.Hardness"),
         speedPenalty: tKey("Modules.SpeedPenalty"),
         hitPoints: tKey("Modules.HitPoints"),
         addModification: tKey("Modules.AddModification"),
         addEntry: tKey("Modules.AddEntry"),
         ruleElement: tKey("Modules.RuleElement"),
         ruleElementJson: tKey("Modules.RuleElementJson"),
         validateRule: tKey("Modules.ValidateRule"),
         formatJson: tKey("Modules.FormatJson"),
         label: tKey("Modules.Label"),
         name: tKey("Modules.Name"),
         icon: tKey("Modules.Icon"),
         description: tKey("Modules.Description"),
         actions: tKey("Modules.Actions"),
         usesAmmunition: tKey("ActionTab.UsesAmmunition"),
         ammunitionTypes: tKey("Weaponry.AmmunitionTypes"),
         dropAmmo: tKey("Modules.DropAmmunition"),
         maxLoaded: tKey("ActionTab.MaxLoaded"),
         spend: tKey("ActionTab.Spend"),
         strikeAttackBonus: tKey("ActionTab.StrikeAttackBonus"),
         rollOptions: tKey("Modules.RollOptions"),
         traits: tKey("ActionTab.Traits"),
         modifyRange: tKey("AmmoTab.ModifyRange"),
         isRangedAttack: tKey("ActionTab.IsRangedAttack"),
         blindRange: tKey("ActionTab.BlindRange"),
         minRangeVolley: tKey("ActionTab.MinRangeVolley"),
         rangeIncrement: tKey("ActionTab.RangeIncrement"),
         maxRange: tKey("ActionTab.MaxRange"),
         modifyArea: tKey("AmmoTab.ModifyArea"),
         attackActionType: tKey("ActionTab.AttackActionType"),
         areaFeet: tKey("ActionTab.AreaFeet"),
         saveDC: tKey("ActionTab.SaveDC"),
         damage: tKey("Modules.Damage"),
         addDamage: tKey("ActionTab.AddDamageInstance"),
         loadCapacity: tKey("Modules.LoadCapacity"),
         speed: tKey("Modules.Speed"),
         savingThrow: tKey("Modules.SavingThrow"),
         value: tKey("Modules.Value"),
         saveReflex: tKey("Attributes.Reflex"),
         saveWill: tKey("Attributes.Will"),
         saveFortitude: tKey("Attributes.Fortitude"),
         targetSlug: tKey("Modules.TargetSlug"),
         loadCapacityDelta: tKey("Modules.LoadCapacityDelta"),
         attackBonusDelta: tKey("Modules.AttackBonusDelta"),
         saveDCDelta: tKey("Modules.SaveDCDelta"),
         loadActionsRequiredDelta: tKey("Modules.LoadActionsRequiredDelta"),
         maxLoadedDelta: tKey("Modules.MaxLoadedDelta"),
         spendDelta: tKey("Modules.SpendDelta"),
         prerequisiteName: tKey("Modules.PrerequisiteName"),
         prerequisiteDelta: tKey("Modules.PrerequisiteDelta"),
         skillName: tKey("Modules.SkillName"),
         skillLoreName: tKey("Modules.SkillLoreName"),
         skillDCDelta: tKey("Modules.SkillDCDelta"),
         selectSkill: tKey("Misc.Select"),
         remove: tKey("Modules.Remove"),
      }
   }


   static actionFlagFromEntry(entry) {
      const isStrike = entry.actionKind !== "ability"
      const ammoSlugs = [
         ...(Array.isArray(entry.ammoTypes) ? entry.ammoTypes.map((ammo) => ammo.slug || ammo.name) : []),
         ...splitCSV(entry.ammoSlugs),
      ].map((slug) => slugify(slug)).filter(Boolean)
      return {
         ...foundry.utils.deepClone(DEFAULT_SIEGE_ACTION_FLAGS),
         isAttack: true,
         isStrike,
         strikeLabel: entry.name || "",
         usesAmmunition: entry.usesAmmunition !== false,
         ammoSlug: ammoSlugs[0] || "",
         ammoSlugs,
         maxLoaded: entry.maxLoaded,
         spend: entry.spend,
         attackBonus: entry.attackBonus || 0,
         damageParts: Array.isArray(entry.damageParts) && entry.damageParts.length
            ? foundry.utils.deepClone(entry.damageParts)
            : [{ ...DEFAULT_DAMAGE_PART }],
         actionType: isStrike ? "" : entry.actionType || "area-fire",
         isRanged: entry.isRanged !== false,
         blindRange: entry.blindRange,
         minRange: entry.minRange,
         rangeIncrement: entry.rangeIncrement,
         maxRange: entry.maxRange,
         areaSize: entry.areaSize || 5,
         areaType: entry.areaType || "burst",
         saveDCPaths: splitCSV(entry.saveDCPaths),
         rollOptions: entry.rollOptions || "",
         traits: entry.traits || "",
      }
   }
}

Object.assign(
   ModuleItemUI,
   moduleTabListenerMethods,
)
