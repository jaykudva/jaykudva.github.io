const CRAWL_SPOTS = [
  {
    name: "Mintish",
    type: "cafe",
    neighborhood: "Capitol Hill",
    // 47.62364944802572, -122.32215711022045
    coords: { lat: 47.62364944802572, lng: -122.32215711022045 },
    note: "i love pistachios and this place has a pistachio latte AND ALLEGEDLY ALSO KUNAFEH",
    mustTry: "pistachio latte"
  },
  {
    name: "Bad Chancla",
    type: "restaurant",
    neighborhood: "Capitol Hill",
    // 47.61841339519224, -122.32540352210754
    coords: { lat: 47.61841339519224, lng: -122.32540352210754 },
    note: "i've read one too many article of this place and the pink exterior intrigues me",
  },
  {
    name: "Piedmont Café",
    type: "cafe",
    neighborhood: "First Hill",
    // 47.611589260496835, -122.32332252345033
    coords: { lat: 47.611589260496835, lng: -122.32332252345033 },
    note: "nice lil break and yap in a pretty area!"
  },
  {
    name: "Seattle Public Library",
    type: "cafe",
    neighborhood: "Downtown Seattle",
    // 47.60660576446164, -122.33099620601068
    coords: { lat: 47.60660576446164, lng: -122.33099620601068 },
    note: "bring a book! or a kindle! or an epub and ur phone! i've never gotten a seattle license or a library card...",
  },
  {
    name: "Biscuit Bitch Pike Place",
    type: "cafe",
    neighborhood: "Pike Place",
    // 47.610390926480875, -122.34055579357343
    coords: { lat: 47.610390926480875, lng: -122.34055579357343 },
    note: "i love a good biscuit",
  },
  {
    name: "Le Panier",
    type: "bakery",
    neighborhood: "Pike Place",
    // 47.609864819966376, -122.3421815737712
    coords: { lat: 47.609864819966376, lng: -122.3421815737712 },
    note: "insert beli bio",
  },
  {
    name: "La Parisienne",
    type: "bakery",
    neighborhood: "Belltown",
    // 47.61672795644439, -122.34519450613996
    coords: { lat: 47.61672795644439, lng: -122.34519450613996 },
    note: "insert beli bio again",
  },
  {
    name: "Seattle Art Museum",
    type: "museum",
    neighborhood: "Belltown",
    // 47.60756901063437, -122.33784570088027
    coords: { lat: 47.60756901063437, lng: -122.33784570088027 },
    note: "i'm p sure tix are like $30 so PLEASE do not feel obligated to shell out if you don't care for this! this'll prob be a logical break in the day if anyone wants to head home, but i've never been here and i'm hoping to spend some decent time :)",
  },
  {
    name: "Bar Bayonne",
    type: "bar",
    neighborhood: "Cherry Hill",
    // 47.6060581636558, -122.31418287104538
    coords: { lat: 47.6060581636558, lng: -122.31418287104538 },
    note: "michael went on a date here and said it was electric. our evening shall begin with this same energy",
  },
  {
    name: "The Hideout",
    type: "bar",
    neighborhood: "First Hill",
    // 47.60951146403485, -122.3250672391851
    coords: { lat: 47.60951146403485, lng: -122.3250672391851 },
    note: "yeah this just looks cool and i've had it saved for forever",
  }
];

// const CRAWL_ROUTE_POLYLINE = "yntaH``riVzA@?BT@?ChB@`B?ZZhA@p@NNFNUXBJHvA@t@?TEz@C?`@FtBJzAHh@TnAT`@Rj@JZZn@X^XTbAz@?E\X@e@V?`A?Z??TXAfEAhAEhA@rBANAT@n@?tCA?E^B@DT?hCA^C?c@V?LIROn@k@`CyBjAeAJKK_@]iAl@g@ZUPO@Dd@vAN\`@lADNPOx@s@DJDG`@]L^Pj@BHCBN^DH\dAd@`B@JNb@BCZ`ALb@`@rALb@BBJZVx@Nd@Tz@L^DAr@rBf@jBb@`Bf@~AC@NZXz@b@rA`@rAVWZ|@FRPODCFGGFC@SP`@jAJRJ^@DWZIFiB`BmA~@cA~@@BABWVCGGFcA|@SPOL?HYXEMONc@f@oBfBAHYVAEOJURw@v@cAx@IHFPZbAd@`BN^BFED`@lADPX~@DNBAPf@?H`@pA`@pADCFPPh@GJKH?C}ArAy@r@]`@ONGDAECDIHm@j@o@j@TT^f@DHWZHLX^RXPZBADFHL@@V^\h@PTQUQ]_@e@EGIMEGC@SYOWe@q@o@_AGKE@[g@g@y@CCCDk@dAwAvCy@|AoDhHw@|A{@fBaCzEcBhDUf@KREIg@s@IIAI[_@EA_@i@[i@c@k@BE[_@E?q@_AUXHLl@x@PXBDBCd@p@P^FHb@n@BFZb@p@z@z@lARZD@Tc@fA{BTWj@gAEEFIDMbBkDr@uADGAC^w@tAwCHQDFBGL]xAoCj@aADQNY?Il@iAn@oAh@eADFN[@GHItAoAFIBDPQBGrBiB`A{@?BHKhAeAhBaBBBT[bCwBh@m@BDRQ@ItAoAXUQe@KUESo@sBIQBGSa@CGDCMa@Oe@Ma@]iACBSg@Ok@W}@_@iACCM]BCGOEO[aA_@qAEGAAO_@Uw@}@_DOe@CC[iAOg@EKO[GW]kAW{@Oc@GQAIEDI_@?ATYNM`@_@dAeAROB?f@c@hAcABGVUJEdB}ABIROROn@g@V[XY`@SpBeB?KTQDC@Bn@s@t@q@JIAEXa@BFDETUXIl@k@FEFEGOg@sAQi@Og@I_@EMi@iBY{@EGQk@q@cCW_AGe@@A?Q?i@@aACiC@yAH_AA_AGo@BeC@{AE?Ai@?k@?m@@wD?mD?_@^?D??U?TE?_@??^?~CAdE?xA@h@D?AzACjCH\AJ@~@I~@?r@Ad@BhCAjBBx@X~@n@xBBHEDa@\iAbAAC]X@Do@j@[XID_@\kC`CWVw@r@KN[HSNGLQHgBbBQL[VACAE"