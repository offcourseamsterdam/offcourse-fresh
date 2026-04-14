**IMPLEMENTATION PRD**

**FareHarbor Booking UI**

Off Course Amsterdam --- Privéérondvaart Boekingsflow

Versie 1.0 --- Opgesteld april 2025

  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  🎯 Doel van dit document: Volledige implementatiehandleiding voor de boekingsflow op Off Course Amsterdam. Bevat FareHarbor configuratie, UI-flow, filterlogica, edge cases en de React component. Gebruik dit als directe voeding voor Claude Code.
  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**1. Context & Doelstelling**

Off Course Amsterdam biedt privérondvaarten over de Amsterdamse
grachten. Er zijn twee boten beschikbaar: Diana (max 8 personen) en
Curaçao (max 12 personen). Klanten boeken altijd de volledige boot ---
nooit losse stoelen op een privévaart.

De boekingsflow moet:

-   Realtime beschikbaarheid ophalen via de FareHarbor API

-   De juiste boot automatisch selecteren op basis van groepsgrootte

-   De klant nooit laten kiezen welke boot --- dit gebeurt onzichtbaar

-   Alleen geldige combinaties tonen van tijdslot, boot en duur

-   Robuust omgaan met alle edge cases: volle boten, gedeelde cruises,
    planning conflicts

**2. FareHarbor Configuratie**

**2.1 één Item, 6 Customer Types**

Alle privérondvaarten zitten in één FareHarbor Item. De duur per boot
zit verwerkt in de customer type --- niet in aparte items. Dit geeft
maximale flexibiliteit per tijdslot.

  --------------------------- ---------------------------------------------------------------------------
  **Instelling**              **Waarde**
  **Aantal Items**            1 (Privérondvaart Amsterdam)
  **Aantal Customer Types**   6 (2 boten × 3 duraties)
  **Customer Types**          Diana 1,5u / Diana 2u / Diana 3u / Curaçao 1,5u / Curaçao 2u / Curaçao 3u
  **Prijsstructuur**          Vlak (vaste bootprijs, niet per persoon)
  **Duratie in FH**           Ingesteld per customer type via starttijd + eindtijd availability
  --------------------------- ---------------------------------------------------------------------------

**2.2 Resources: Capacity = 1**

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ⚠️ Kritiek: Stel de resource capacity in FareHarbor in op 1 (niet op 8 of 12). Één boot = één resource unit. Zodra geboekt, zet FH de capacity automatisch naar 0 voor alle overlappende slots.
  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Hierdoor werkt conflict-detectie automatisch:

-   Diana geboekt voor 10:00 -- 3 uur → Diana resource bezet t/m 13:00

-   FH zet Diana capacity naar 0 op elk overlappend tijdslot

-   Jouw UI filtert hierop --- geen extra logica nodig

-   Curaçao bezet door shared cruise → zelfde mechanisme, automatisch

**2.3 Customer Type PKs**

PKs veranderen nooit in FareHarbor, namen wel. Alle filterlogica in de
UI werkt op PKs --- nooit op namen.

  ------------------------- --------------------------------------
  **Instelling**            **Waarde**
  **Diana --- 1,5 uur**     PK: \[invullen vanuit FH dashboard\]
  **Diana --- 2 uur**       PK: \[invullen vanuit FH dashboard\]
  **Diana --- 3 uur**       PK: \[invullen vanuit FH dashboard\]
  **Curaçao --- 1,5 uur**   PK: \[invullen vanuit FH dashboard\]
  **Curaçao --- 2 uur**     PK: \[invullen vanuit FH dashboard\]
  **Curaçao --- 3 uur**     PK: \[invullen vanuit FH dashboard\]
  ------------------------- --------------------------------------

**3. UI Flow**

**3.1 Stap-voor-stap**

De klant doorloopt de volgende stappen. Datum en aantal gasten worden
eerder in de flow al ingevuld --- dit scherm veronderstelt dat ze
beschikbaar zijn als props.

  --------------------- --------------------------------------------------------------------------------
  **Instelling**        **Waarde**
  **Stap 0 (eerder)**   Klant kiest datum + voert guestCount in
  **Stap 1**            Tijdslot kiezen --- alleen geldige slots getoond
  **Stap 2A**           Bootkaarten verschijnen --- met duratie-buttons per boot
  **Stap 2B**           Klant kiest een duur op de gewenste boot
  **Stap 3**            Boek nu --- doorsturen naar FH checkout met availability PK + customer type PK
  --------------------- --------------------------------------------------------------------------------

**3.2 API Aanroep**

Fetch één keer bij datumkeuze. Daarna alles client-side filteren.

> GET /api/v1/companies/{shortname}/availabilities/date/{date}/

Response bevat per availability de customer\_type\_rates met capacity
per customer type. Capacity = 1 betekent beschikbaar, capacity = 0
betekent bezet.

**4. Filterlogica**

**4.1 BOAT\_CONFIG**

De centrale configuratie die bootspecificaties koppelt aan FH customer
type PKs.

> const CUSTOMER\_TYPES = {
>
> \[DIANA\_1H5\_PK\]: { boat: \'diana\', duration: 90, maxGuests: 8,
> priority: 1 },
>
> \[DIANA\_2H\_PK\]: { boat: \'diana\', duration: 120, maxGuests: 8,
> priority: 1 },
>
> \[DIANA\_3H\_PK\]: { boat: \'diana\', duration: 180, maxGuests: 8,
> priority: 1 },
>
> \[CURACAO\_1H5\_PK\]: { boat: \'curacao\', duration: 90, maxGuests:
> 12, priority: 2 },
>
> \[CURACAO\_2H\_PK\]: { boat: \'curacao\', duration: 120, maxGuests:
> 12, priority: 2 },
>
> \[CURACAO\_3H\_PK\]: { boat: \'curacao\', duration: 180, maxGuests:
> 12, priority: 2 },
>
> };

**4.2 Geldige Tijdslots**

Een slot is geldig als er minstens één customer type is waarbij: (1)
maxGuests \>= guestCount, en (2) capacity \>= 1.

> function getValidTimeSlots(availabilities, guestCount) {
>
> return availabilities.filter(a =\>
>
> a.customer\_type\_rates.some(rate =\> {
>
> const config = CUSTOMER\_TYPES\[rate.customer\_type.pk\];
>
> if (!config) return false;
>
> if (config.maxGuests \< guestCount) return false;
>
> if ((rate.capacity ?? 0) \< 1) return false;
>
> return true;
>
> })
>
> );
>
> }

**4.3 Beschikbare Duraties per Boot**

Na tijdskeuze: per boot de duraties ophalen die nog beschikbaar zijn
voor de groepsgrootte.

> function getAvailableDurations(availability, boatId, guestCount) {
>
> return availability.customer\_type\_rates
>
> .filter(rate =\> {
>
> const config = CUSTOMER\_TYPES\[rate.customer\_type.pk\];
>
> if (!config \|\| config.boat !== boatId) return false;
>
> if (config.maxGuests \< guestCount) return false;
>
> if ((rate.capacity ?? 0) \< 1) return false;
>
> return true;
>
> })
>
> .sort((a, b) =\> CUSTOMER\_TYPES\[a.customer\_type.pk\].duration
>
> \- CUSTOMER\_TYPES\[b.customer\_type.pk\].duration);
>
> }

**4.4 Bootstatus**

Per boot bepalen of hij beschikbaar is, te klein is, of volgeboekt ---
voor de badge in de UI.

> function getBoatStatus(availability, boatId, guestCount) {
>
> const boat = BOATS.find(b =\> b.id === boatId);
>
> if (boat.maxGuests \< guestCount)
>
> return { available: false, reason: \'too\_large\' };
>
> const available = getAvailableDurations(availability, boatId,
> guestCount);
>
> if (available.length === 0)
>
> return { available: false, reason: \'fully\_booked\' };
>
> return { available: true };
>
> }

**5. UI Component Structuur**

**5.1 State**

  -------------------- ----------------------------------------------------
  **Instelling**       **Waarde**
  **selectedSlotPk**   PK van het gekozen tijdslot (availability)
  **selectedTypePk**   PK van de gekozen customer type (boot + duur)
  **canBook**          true als beide ingevuld --- activeert Boek nu knop
  -------------------- ----------------------------------------------------

**5.2 Visuele Structuur**

-   Header: datum + guestCount als context (read-only, al gekozen)

-   Stap 1: Tijdknoppen --- alleen geldige slots, horizontaal
    gerangschikt

-   Stap 2: Twee bootkaarten --- verschijnen na tijdkeuze (opacity
    transitie)

-   Per bootkaart: foto, naam, max personen, duratie-knoppen

-   Niet-beschikbare boot: 40% opacity, pointer-events none, badge met
    reden

-   Boek nu: disabled tot tijdslot én duur gekozen --- toont
    samenvatting eronder

**5.3 Naar Checkout**

Bij Boek nu worden twee waarden doorgegeven aan FareHarbor:

  ----------------------- --------------------------------------------------
  **Instelling**          **Waarde**
  **availability pk**     Het pk van het geselecteerde tijdslot
  **customer\_type pk**   Het pk van de geselecteerde boot+duur combinatie
  ----------------------- --------------------------------------------------

De klant ziet nooit welke boot er intern geselecteerd is. De bootnaam
verschijnt wel op de kaart, maar de keuze voor welke boot wordt gemaakt
door de filterlogica --- niet door de klant.

**6. Edge Cases**

**6.1 Aannames vanuit UI (niet te valideren)**

  -------------------------------------------------------------------------------------------------------------------------------------------------------
  guestCount is altijd een integer \>= 1, aangeleverd vanuit een eerdere stap in de flow. Input validatie op guestCount is niet nodig in dit component.
  -------------------------------------------------------------------------------------------------------------------------------------------------------

**6.2 Volledige Edge Case Tabel**

  ------------------------- ------------------------------------------- ---------------- ----------------- -------------- -------------------------------------------------------------------
  **\#**                    **Situatie**                                **guestCount**   **Diana**         **Curaçao**    **Verwacht resultaat**
  **NORMAAL**                                                                                                             
  1                         Kleine groep, beide boten vrij              4                Vrij              Vrij           Diana getoond met alle duraties, Curaçao ook getoond
  2                         Precies Diana-max                           8                Vrij              Vrij           Diana getoond, Curaçao ook getoond
  3                         Net boven Diana-max                         9                N.v.t.            Vrij           Diana gegreyed (too\_large), Curaçao getoond
  4                         Precies Curaçao-max                         12               N.v.t.            Vrij           Diana gegreyed (too\_large), Curaçao getoond
  5                         Meerdere slots beschikbaar                  6                Vrij              Vrij           Alle geldige tijdslots getoond als knoppen
  6                         Slechts één slot beschikbaar                10               N.v.t.            Vrij           Dat ene slot getoond, geen probleem
  **FALLBACK & CONFLICT**                                                                                                 
  7                         Diana vol, kleine groep                     5                Vol               Vrij           Diana gegreyed (fully\_booked), Curaçao getoond met alle duraties
  8                         Diana vol op exacte max                     8                Vol               Vrij           Diana gegreyed, Curaçao getoond
  9                         Curaçao vol, grote groep                    10               N.v.t.            Vol            Tijdslot verborgen (geen geldige rate)
  10                        Curaçao bezet door shared cruise            10               N.v.t.            Vol (shared)   FH zet capacity 0, slot automatisch verborgen
  11                        Curaçao vol, Diana te klein                 9                Te klein          Vol            Tijdslot volledig verborgen
  12                        Beide boten vol                             6                Vol               Vol            Tijdslot verborgen
  13                        Alle slots op datum vol                     7                Vol (alle)        Vol (alle)     Lege state: \'Alle vaarten volgeboekt\'
  14                        Planningconflict (Diana 3u op 10:00)        5                Bezet t/m 13:00   Vrij           FH zet Diana capacity 0 op 11:00 en 12:00 automatisch
  **DURATIE-SPECIFIEK**                                                                                                   
  15                        Diana 3u vol, 1,5u en 2u nog vrij           6                Gedeeltelijk      Vrij           Diana getoond met alleen 1,5u en 2u knoppen
  16                        Curaçao 1,5u vol, rest vrij                 10               N.v.t.            Gedeeltelijk   Curaçao getoond zonder 1,5u knop
  17                        Alle Diana duraties vol                     6                Alle vol          Vrij           Diana gegreyed (fully\_booked), Curaçao getoond
  **DATA KWALITEIT**                                                                                                      
  18                        Availability zonder customer\_type\_rates   ---              ---               ---            Slot geskipt via .some() check, geen crash
  19                        Rate zonder capacity veld                   ---              ---               ---            ?? 0 fallback, behandeld als 0
  20                        Onbekende customer type PK in response      ---              ---               ---            CUSTOMER\_TYPES\[pk\] = undefined → geskipt
  21                        FH API timeout of fout                      ---              ---               ---            try/catch, reason: API\_ERROR, foutmelding tonen
  22                        FH geeft lege array terug                   ---              ---               ---            Lege state: \'Geen vaarten beschikbaar op deze datum\'
  **DATUM**                                                                                                               
  23                        Datum in verleden                           ---              ---               ---            Blokkeren vóór API call, geen fetch
  24                        Datum te ver in toekomst                    ---              ---               ---            FH geeft lege array, zelfde als case 22
  **UX FLOW**                                                                                                             
  25                        Klant wijzigt guestCount na tijdskeuze      ---              ---               ---            selectedTypePk resetten, opnieuw filteren
  26                        Klant wijzigt datum na slotkeuze            ---              ---               ---            Opnieuw fetchen, beide selections resetten
  27                        Klant kiest tijdslot, gaat terug            ---              ---               ---            State bewaren, niet opnieuw fetchen
  28                        Slot vol geworden tijdens sessie            ---              ---               ---            FH weigert booking, foutmelding tonen, opnieuw fetchen
  29                        Klant klikt Boek nu zonder selectie         ---              ---               ---            Knop disabled, niet mogelijk
  ------------------------- ------------------------------------------- ---------------- ----------------- -------------- -------------------------------------------------------------------

**6.3 Reason Codes & UI Berichten**

  ------------------------ ---------------------------------------------------------------------
  **Instelling**           **Waarde**
  **null**                 Geen bericht, gewoon slots tonen
  **TOO\_LARGE**           Onze boten zijn geschikt voor maximaal 12 personen.
  **ALL\_FULL**            Alle vaarten op deze datum zijn volgeboekt voor jouw groepsgrootte.
  **NO\_AVAILABILITIES**   Er zijn geen vaarten beschikbaar op deze datum.
  **PAST\_DATE**           Je kunt niet boeken voor een datum in het verleden.
  **API\_ERROR**           Er ging iets mis. Probeer het opnieuw of neem contact op.
  ------------------------ ---------------------------------------------------------------------

**7. Instructies voor Claude Code**

**7.1 Wat al gebouwd is**

-   BoatSelector.jsx --- volledig werkende React component met mock data

-   Alle filterlogica geïmplementeerd en getest op edge cases

-   Styling in navy/goud thema, mobile-first

-   State management: selectedSlotPk + selectedTypePk

**7.2 Wat nog gebouwd moet worden**

-   Echte FH API call: vervang MOCK\_AVAILABILITIES met fetch naar
    /api/v1/companies/offcourse/availabilities/date/{date}/

-   CUSTOMER\_TYPES PKs invullen met echte waarden uit FH dashboard

-   Props uitbreiden: date en guestCount komen uit de parent flow

-   handleBookNow: doorsturen naar FH checkout URL of booking API call

-   Foto's van Diana en Curaçao toevoegen in de placeholder

-   Loading state toevoegen tijdens API fetch

-   Error boundary voor API\_ERROR cases

**7.3 Testen voor Go-Live**

  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Maak een testboeking in FH voor Diana 3 uur op 10:00. Check daarna via de API of het 11:00 en 12:00 slot voor Diana capacity: 0 retourneert. Zo verifieer je dat de resource-configuratie correct werkt.
  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

-   Case 7: Diana vol → Curaçao als fallback

-   Case 10: Curaçao bezet door shared cruise → automatisch verborgen

-   Case 14: Planningconflict → FH blokkeert overlappende slots

-   Case 25: guestCount wijzigen na slotkeuze → reset correct

-   Case 28: Race condition → FH weigert, UI toont foutmelding

**7.4 Niet te veranderen**

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ❌ De capacity van resources in FH moet altijd op 1 blijven. Nooit op 8 of 12 zetten. Groepsgrootte filtering gebeurt uitsluitend via de maxGuests mapping in CUSTOMER\_TYPES.
  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

--- Einde document ---
