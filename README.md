Engines of War automates siege weapons and vehicles on a very high level.

1. [What It Does](#what-it-does)
2. [First Setup](#first-setup)
3. [Moving vehicle/siege weapon around as a player](#moving-vehicle-or-siege-weapon-around-as-a-player)
4. [Needs ignition](#needs-ignition)
5. [Actions and Strikes set up](#actions-and-strikes-set-up)
6. [Crew HUD](#crew-hud)
7. [Vehicle HUD](#vehicle-hud)
8. [How do portable siege weapons work?](#how-do-portable-siege-weapons-work)
9. [Crew](#crew)
10.   [Ammunition](#ammunition)
11.   [Modules](#modules)
12.   [RIP & TEAR INTEGRATION! TEAR YOUR VEHICLE APART!!](#rip-n-tear-integration)
13.   [Precautions](#precautions)
14.   [Screenshots](#screenshots)

## What It Does

Engines of War lets a GM convert a PF2e vehicle actor into a working, highly customisable siege weapon and enterable vehicle.

**The module features:**

1. A converted vehicle can have dedicated crew positions, that have different levels of accesses to the vehicle/siege weapon's actions/attacks. It includes ranking system as well, and different ranks can have different accessess alongside different crewmember positions;
2. All sorts of weaponry with all sorts of different ammunition and very advanced ammunition management system;
3. Fully automated support for portable siege weapons according to all RAW rules;
4. Advanced actions system -- many default actions are included and automated, such as load/repair/move/etc...;
5. Vehicle modules system -- players can install WORKING shields, headlights, and other stuff that somehow improves the vehicle;
6. Highly customisable SFX for just for every occasion;
7. Highly customisable and detailed Crew and Vehicle user HUDs, through which the user can interact with the vehicle on the expected level without any ownership;
8. Players can control vehicles and have access to all actions and can even MOVE the vehicle around **without** needing to have any ownership over the siege weapon or a vehicle;
9. Feats support (like Shorthanded artillerist's feat)
10.   Macro for automated Creature Hauling

## First Setup

1. Create or open a PF2e vehicle actor.
2. Open the vehicle sheet.
3. Check **Convert to Siege Weapon**.
4. Check "Enterable" if you want it to become an enterable vehicle instead.
5. Configure the new siege weapon through the vehicle sheet: add crew member positions, define actions/strikes, define accesses to these actions, etc.
6. Add the vehicle token to the scene.
7. In order to MOUNT the siege weapon, the player should simply double click on the vehicle token. Same with the enterable vehicle. GMs, on the other hand, must use dedicated macros: Mount (for Siege Weapon) and Enter (for enterable vehicles).
8. When entering the vehicle, your Bulk is calculated in accordance with Bulk calculation rules and is added to this Vehicle stash.
9. To operate the vehicle, one has different options: either press "L" hotkey to open up a hotkey panel; or press on "H" hotkey to open up a Crew HUD where you will see the "Actions" button when hovering over your actor; double RMB click on the vehicle to open up Actions dialog; use "Actions" macro
10.   If more than one owned tokens are on the active scene, the player can _target_ the token that they want to manipualte the vehicle with (meaning, mounting the vehicle/toggling ACtions dialog, etc).

### Moving vehicle or siege weapon around as a player

If you want let a player to move a non-enterable siege weapon around, you need to assign the crew access to the "Move" default action.

For enterable vehicles, there is a "Driver" role created automatically, which allows for moving the vehicle.

### Needs ignition

You can demand to have the vehicle be ignited first before allowing to use its actions. You can also set up, which action can be used and which cannot be on the non-launched vehicle. You can define a slug of a "key" that is needed to launch the vehicle -- the one who's launching it must have the item with the defined in their inventory in order to launch the vehicle.

### Actions and Strikes set up

In order to set up an Action or Strike in the action tab, you need to open up the actions/strike's sheet and navigate to the "Engines of War" tab with a wheel icon. From there, everything is _somewhat_ straightforward.

### Crew HUD

1. Default hotkey "H" -- opens up an elaborative HUD with all current crew members. You can:
   a) Set their "Crew portrait", which is a highly customisable and neat feature
   b) Click on the portrait itself to open up this character's sheet (if you have any access)
   c) Do all sorts of stuff with the buttons presented there (the functionality is pretty straightforward)

### Vehicle HUD

You can access it 3 ways: default hotkey "V"; RMB on the vehicle and in token HUD, on the left bottom, there's be a cobalt wheel icon; press "I" default hotkey to open up Vehicle's Stash and navigate from there; open up Crew HUD and click on the gears button on the left side of the Crew HUD. The HUD was made for users, so it is very straightforward.

### How do portable siege weapons work?

So you must define it's Bulk first. Then, this Bulk must be lifted by the crewmembers. The process is the same as with Mounting the siege weapon -- you simply Mount it, and in process, you are asked to Carry thr amount of this weapon's Bulk. When you lift some Bulk, this Bulk is added to your inventory while you're lifting. You also must choose the crew leader during that, because only THEY can MOVE and ATTACK with the portable siege weapon. Other than that, everything else is automated. You can delegate the Bulk and delegate the Leadership.

## Crew

Crew positions decide who can operate a vehicle and what accesses do they have. You can also define some extras (the Gear button near the Trash Can button): to substitute Vehicle's SSaving Throws with this crew member's saving throws; to apply effect on the crew member for just being on this position; define, whether this crew member can be targeted (need to check "Allow targeting crewmembers" in the Details tab of the Vehicle's sheet)

## Ammunition

Ammunition is defined on the vehicle first, then assigned to weapons.

1. Add ammunition types in the Ammunition tab of Vehicle sheet.
2. Create an item with the Ammunition type, navigate to the Engines of War tab inside of it and set it up if you wish (this is optional. If you leave it unmodified, then it will use all of the weapon statistics)
3. Add ammunition items to the vehicle stash, a crewmember, or an adjacent eligible token.
4. Assign one or more ammunition types to a strike or module action. Different ammunition types can affect the
5. Use **Manage Ammunition** from the Vehicle HUD or Actions dialog (GMs can also access it through Vehicle sheet itself).

Loading can draw ammunition from the vehicle stash, the acting crewmember, and adjacent eligible tokens. Reloading, switching, and unloading use the same ammunition manager.

### Modules

1. To install Modules, you must first define module type in Engines of War settings.
2. Then you need to create an "Equipment" item. There, in its sheet, will be a tab with a cube icon. Setting it up is pretty straightforward. To make Shields or Light for the vehicle, you must make a module item with this rule.
3. Then, you need to place the item in the vehicle's stash, and in order to actually make it work, you need to install in through Vehicle's HUD "Modules" tab.
4. In order to do that, you first need to create a "module socket" by clicking RMB on the module tab's canvas and choosing "Add Vehicle's Module"
5. You can also add a "component module" -- it is a "sub-module" that modifies _the module itself_ -- by RMB on the module socket and choosing "Install component module"
6. You can also define default modules that "come with the package" and are, basically, actions and strikes manually created by GM. For that, you need to check "Is Component" in the action/strike "Engines of War" tab, It will then be added as a non-removable/non-changeable default module. You can create sub-modules for it, though.
7. To install module, just RMB on the empty socket and choose "Install module".

## RIP N TEAR INTEGRATION!

If you have Aztec's RIP & TEAR module, you can use it with the Vehicles. The module appends a tab with the bone icon in the vehicle sheet, where you can define the "body parts" of the vehicle. Bonus: you can apply threshold effects not only on the vehicle itself, but also on certain crewmember positions (e.g. the Coolant Chamber was breached, and so the vehicle itself and _all Engineers_ take cold damage).
You can also Repair the modules through Repair action!

## Precautions

Exit the vehicle before using a crewmember token outside it. A token that remains entered can be hidden, shrunk, moved with the vehicle, or treated as an internal crewmember by targeting and consequence logic.

## Screenshots
<img width="1087" height="634" alt="portable-mount" src="https://github.com/user-attachments/assets/c9d75f4c-5117-45d6-96bb-7fc37127e202" />
<img width="601" height="492" alt="portable-lift" src="https://github.com/user-attachments/assets/1bca4a77-02da-4a29-bedd-df2921dbe497" />
<img width="1061" height="764" alt="haul" src="https://github.com/user-attachments/assets/24a69c37-3da7-4a60-bf17-eeb1aa106cbb" />
<img width="812" height="852" alt="haul2" src="https://github.com/user-attachments/assets/752349f7-75ea-44f7-b2ba-13035876c789" />
<img width="884" height="589" alt="module-shield" src="https://github.com/user-attachments/assets/af30c570-f6a3-4d62-911f-ca6b21bd04cd" />
<img width="1755" height="586" alt="ammunition-types" src="https://github.com/user-attachments/assets/13613d26-4a71-4086-a0e9-85003d385f94" />
<img width="657" height="504" alt="ammunition-manager" src="https://github.com/user-attachments/assets/46fe8fdf-4f0e-4283-93c2-6a26247cb931" />
<img width="1632" height="998" alt="strike-setup1" src="https://github.com/user-attachments/assets/834914d8-f7ae-42c3-94be-04fde60e7909" />
<img width="1436" height="336" alt="strike-setup2" src="https://github.com/user-attachments/assets/647f6de6-55bf-49d5-b343-9dfc3983ecbd" />
<img width="686" height="395" alt="strike-setup3" src="https://github.com/user-attachments/assets/c649c139-03a8-4dfe-b72f-03381d869372" />
<img width="849" height="551" alt="action-setup" src="https://github.com/user-attachments/assets/ea589459-f463-4e89-8763-b3cd61bf8e76" />
<img width="743" height="371" alt="crew-hud" src="https://github.com/user-attachments/assets/34261a55-9d08-4c68-8947-269f7877e5df" />
<img width="1059" height="615" alt="vehicle-hud" src="https://github.com/user-attachments/assets/6fc0005c-c496-4ba4-b1d7-885d4370634e" />
<img width="1077" height="698" alt="modules" src="https://github.com/user-attachments/assets/5295a618-ee31-4d20-a725-e936b827b41b" />
<img width="1085" height="616" alt="ranks" src="https://github.com/user-attachments/assets/3ea5b029-48c1-4457-bdd7-87bbfe84c022" />
<img width="1103" height="849" alt="vehicle-sheet-weapon" src="https://github.com/user-attachments/assets/13dc93e3-118c-4429-a79d-b95eff5a4266" />
<img width="1074" height="848" alt="vehicle-sheet-detail" src="https://github.com/user-attachments/assets/30c5ebe7-2e99-4c57-ac3e-8807145deec8" />
<img width="1069" height="848" alt="vehicle-sheet-crew" src="https://github.com/user-attachments/assets/6e86d789-ee5e-4f8d-b967-85475ce82d20" />
<img width="1063" height="839" alt="vehicle-sheet-sfx" src="https://github.com/user-attachments/assets/1c4db394-f13e-41f2-b5a4-43449e3421f8" />
<img width="1074" height="846" alt="rip-n-tear" src="https://github.com/user-attachments/assets/b90d2176-f07f-43e5-84e4-51460e4d4384" />
<img width="726" height="131" alt="hotkey" src="https://github.com/user-attachments/assets/0421ca25-ecfe-4804-af13-a213c0617a11" />
<img width="565" height="804" alt="actions" src="https://github.com/user-attachments/assets/0cc9759b-10cb-49f7-934e-398fc7101358" />
