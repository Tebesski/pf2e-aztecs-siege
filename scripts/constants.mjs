export const MODULE_ID = "pf2e-aztecs-siege"

export const PF2E_SKILLS = [
   "perception",
   "acrobatics",
   "arcana",
   "athletics",
   "crafting",
   "deception",
   "diplomacy",
   "intimidation",
   "medicine",
   "nature",
   "occultism",
   "performance",
   "religion",
   "society",
   "stealth",
   "survival",
   "thievery",
]

export const PF2E_DAMAGE_TYPES = [
   "bludgeoning",
   "piercing",
   "slashing",
   "acid",
   "cold",
   "electricity",
   "fire",
   "sonic",
   "force",
   "vitality",
   "void",
   "mental",
   "poison",
   "bleed",
   "spirit",
   "holy",
   "unholy",
   "untyped",
]

export const WEAPON_PROFS = ["unarmed", "simple", "martial", "advanced"]

export const DAMAGE_CATEGORIES = ["normal", "persistent", "splash", "precision"]

export const AREA_TYPES = ["burst", "cone", "emanation", "line"]

export const DIE_SIZES = ["-", "d4", "d6", "d8", "d10", "d12"]

export const ACTION_TYPES_AREA = ["area-fire", "auto-fire"]

export const PHYSICAL_ITEM_TYPES = [
   "weapon",
   "armor",
   "equipment",
   "consumable",
   "treasure",
   "backpack",
   "shield",
   "ammunition",
]

export const DC_BY_LEVEL = [
   14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38,
   39, 40, 42, 44, 46, 48, 50,
]

export const DAMAGE_COLOR_MAP = {
   fire: "#e85d04",
   cold: "#00b4d8",
   acid: "#70e000",
   electricity: "#ffb703",
   bludgeoning: "#6c757d",
   piercing: "#adb5bd",
   slashing: "#adb5bd",
   sonic: "#0077b6",
   force: "#7209b7",
   vitality: "#ffb703",
   void: "#3a0ca3",
   mental: "#f72585",
   poison: "#008000",
   bleed: "#d90429",
   spirit: "#e0aaff",
   holy: "#ffea00",
   unholy: "#370617",
   untyped: "#ffffff",
}

export const DAMAGE_ICON_MAP = {
   fire: "fa-fire",
   cold: "fa-snowflake",
   acid: "fa-flask",
   electricity: "fa-bolt",
   bludgeoning: "fa-hammer",
   piercing: "fa-bow-arrow",
   slashing: "fa-sword",
   sonic: "fa-volume-high",
   force: "fa-sparkles",
   vitality: "fa-sun",
   void: "fa-moon",
   mental: "fa-brain",
   poison: "fa-skull-crossbones",
   bleed: "fa-droplet",
   spirit: "fa-ghost",
   holy: "fa-cross",
   unholy: "fa-pentagram",
   untyped: "fa-circle",
}

export const DEFAULT_SIEGE_ACTION_FLAGS = {
   crewAccess: [],
   prerequisites: [],
   removePrereqsOnUse: true,
   unlimitedDuration: false,
   effectDuration: 1,
   effectExpiry: "turn-start",
   takeAmmoFromAdjacent: false,
   loadThreshold: 1,
   rollOptions: "",
   skills: [],
   isAttack: false,
   isStrike: false,
   usesAmmunition: true,
   ammoSlug: "",
   spend: "",
   proficiencies: [{ name: "martial", loreName: "" }],
   attackBonus: 0,
   damageParts: [
      { dice: 1, die: "d6", type: "bludgeoning", category: "normal" },
   ],
   actionType: "",
   isRanged: true,
   blindRange: "",
   minRange: "",
   rangeIncrement: 120,
   maxRange: 600,
   subjectToMAP: true,
   areaSize: 5,
   areaType: "burst",
   saveDC: 20,
}

export const DEFAULT_AMMO_IMG = "icons/weapons/ammunition/shot-round-lead.webp"
export const DEFAULT_PERSON_IMG = "icons/svg/mystery-man.svg"
export const DEFAULT_LIFTED_IMG = "icons/equipment/back/pack-leather-brown.webp"

export const D20_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 0 19 19" preserveAspectRatio="xMinYMin meet"><path fill-rule="evenodd" fill="currentColor" d="M3.826,8.060 L0.124,13.540 C0.016,13.716 0.127,13.944 0.332,13.967 L7.637,14.743 L3.826,8.060 L3.826,8.060 ZM0.341,11.589 L2.983,7.288 L0.294,5.672 C0.200,5.615 0.081,5.683 0.081,5.792 L0.081,11.515 C0.081,11.657 0.267,11.710 0.341,11.589 ZM0.722,15.391 L7.541,18.472 C7.727,18.559 7.939,18.422 7.939,18.217 L7.939,15.909 L0.799,15.125 C0.643,15.107 0.580,15.321 0.722,15.391 L0.722,15.391 ZM3.571,6.330 L6.375,1.305 C6.527,1.057 6.249,0.769 5.996,0.913 L0.706,4.380 C0.620,4.437 0.622,4.565 0.711,4.618 L3.571,6.330 L3.571,6.330 ZM8.500,6.687 L12.331,6.687 L8.978,0.769 C8.869,0.590 8.684,0.501 8.500,0.501 C8.316,0.501 8.132,0.590 8.022,0.769 L4.669,6.687 L8.500,6.687 ZM16.707,5.672 L14.018,7.288 L16.659,11.589 C16.733,11.710 16.919,11.657 16.919,11.515 L16.919,5.792 C16.919,5.683 16.800,5.615 16.707,5.672 ZM13.430,6.330 L16.290,4.618 C16.379,4.564 16.381,4.436 16.294,4.379 L11.004,0.913 C10.752,0.769 10.474,1.057 10.626,1.305 L13.430,6.330 ZM16.202,15.125 L9.062,15.908 L9.062,18.217 C9.062,18.422 9.274,18.558 9.460,18.472 L16.279,15.391 C16.420,15.321 16.358,15.107 16.202,15.125 L16.202,15.125 ZM13.175,8.060 L9.364,14.743 L16.669,13.967 C16.874,13.944 16.986,13.716 16.877,13.540 L13.175,8.060 L13.175,8.060 ZM8.500,7.812 L4.977,7.812 L8.500,13.990 L12.023,7.812 L8.500,7.812 Z"></path></svg>`

export const ACTION_TEMPLATES = {
   aiming: {
      nameKey: "ActionTemplates.Aim.Name",
      descKey: "ActionTemplates.Aim.Desc",
      skills: [],
   },
   loading: {
      nameKey: "ActionTemplates.Load.Name",
      descKey: "ActionTemplates.Load.Desc",
      skills: [{ name: "athletics", loreName: "", dc: "" }],
      traits: "manipulate",
   },
   moving: {
      nameKey: "ActionTemplates.Move.Name",
      descKey: "ActionTemplates.Move.Desc",
      skills: [{ name: "athletics", loreName: "", dc: "" }],
      actionsCost: 2,
   },
   disassemble: {
      nameKey: "ActionTemplates.Disassemble.Name",
      descKey: "ActionTemplates.Disassemble.Desc",
      skills: [],
   },
   reassemble: {
      nameKey: "ActionTemplates.Reassemble.Name",
      descKey: "ActionTemplates.Reassemble.Desc",
      skills: [],
   },
   customAction: {
      nameKey: "ActionTemplates.CustomAction.Name",
      descKey: "ActionTemplates.CustomAction.Desc",
      skills: [],
   },
}

export const ATTACK_TEMPLATES = {
   strike: {
      nameKey: "AttackTemplates.Strike.Name",
      descKey: "AttackTemplates.Strike.Desc",
      skills: [],
      prereqs: [{ name: "Loaded", count: 1 }],
      isStrike: true,
      actionType: "",
      traits: "manipulate",
   },
   ability: {
      nameKey: "AttackTemplates.Ability.Name",
      descKey: "AttackTemplates.Ability.Desc",
      skills: [],
      prereqs: [{ name: "Loaded", count: 1 }],
      isStrike: false,
      actionType: "area-fire",
      traits: "manipulate",
   },
}
