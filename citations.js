/* Full references for each study.
 *
 * Every field was read off the article's own front matter with
 *   pdftotext -f 1 -l 1 -layout <folder>/full_text.pdf -
 * and checked against the DOI printed in the PDF. Nothing here is inferred
 * from the folder name — see the `note` fields, where two folder names
 * disagree with the year the paper actually appeared.
 *
 * Issue numbers are deliberately omitted: volume, pages and DOI are all
 * confirmed on the page, issue numbers mostly were not.
 */
window.CITATIONS = {
  ai_2020: {
    authors: ['Ai, Z.', 'Hanasaki, N.', 'Heck, V.', 'Hasegawa, T.', 'Fujimori, S.'],
    year: 2020,
    title: 'Simulating second-generation herbaceous bioenergy crop yield using the global hydrological model H08 (v.bio1)',
    journal: 'Geoscientific Model Development',
    volume: '13', pages: '6077–6092',
    doi: '10.5194/gmd-13-6077-2020',
    open: true
  },

  daly_2017: {
    authors: ['Daly, C.', 'Halbleib, M.D.', 'Hannaway, D.B.', 'Eaton, L.M.'],
    year: 2018,
    title: 'Environmental limitation mapping of potential biomass resources across the conterminous United States',
    journal: 'GCB Bioenergy',
    volume: '10', pages: '717–734',
    doi: '10.1111/gcbb.12496',
    note: 'The folder is named daly_2017, but the article carries a 2018 issue date. Cite it as 2018.'
  },

  davis_2012: {
    authors: ['Davis, S.C.', 'Parton, W.J.', 'Del Grosso, S.J.', 'Keough, C.',
              'Marx, E.', 'Adler, P.R.', 'DeLucia, E.H.'],
    year: 2012,
    title: 'Impact of second-generation biofuel agriculture on greenhouse-gas emissions in the corn-growing regions of the US',
    journal: 'Frontiers in Ecology and the Environment',
    volume: '10', pages: '69–74',
    doi: '10.1890/110003'
  },

  li_2020: {
    authors: ['Li, W.', 'Ciais, P.', 'Stehfest, E.', 'van Vuuren, D.', 'Popp, A.',
              'Arneth, A.', 'Di Fulvio, F.', 'Doelman, J.', 'Humpenöder, F.',
              'Harper, A.B.', 'Park, T.', 'Makowski, D.', 'Havlik, P.',
              'Obersteiner, M.', 'Wang, J.', 'Krause, A.', 'Liu, W.'],
    year: 2020,
    title: 'Mapping the yields of lignocellulosic bioenergy crops from observations at the global scale',
    journal: 'Earth System Science Data',
    volume: '12', pages: '789–804',
    doi: '10.5194/essd-12-789-2020',
    open: true,
    note: 'The only map here that is not digitized — its values come from the authors’ published Bioenergy_crop_yields.nc.'
  },

  littleton_2020: {
    authors: ['Littleton, E.W.', 'Harper, A.B.', 'Vaughan, N.E.', 'Oliver, R.J.',
              'Duran-Rojas, M.C.', 'Lenton, T.M.'],
    year: 2020,
    title: 'JULES-BE: representation of bioenergy crops and harvesting in the Joint UK Land Environment Simulator vn5.1',
    journal: 'Geoscientific Model Development',
    volume: '13', pages: '1123–1136',
    doi: '10.5194/gmd-13-1123-2020',
    open: true
  },

  miguez_2012: {
    authors: ['Miguez, F.E.', 'Maughan, M.', 'Bollero, G.A.', 'Long, S.P.'],
    year: 2012,
    title: 'Modeling spatial and dynamic variation in growth, yield, and yield stability of the bioenergy crops Miscanthus × giganteus and Panicum virgatum across the conterminous United States',
    journal: 'GCB Bioenergy',
    volume: '4', pages: '509–520',
    doi: '10.1111/j.1757-1707.2011.01150.x'
  },

  shepherd_2020: {
    authors: ['Shepherd, A.', 'Littleton, E.', 'Clifton-Brown, J.', 'Martin, M.',
              'Hastings, A.'],
    year: 2020,
    title: 'Projections of global and UK bioenergy potential from Miscanthus × giganteus—Feedstock yield, carbon cycling and electricity generation in the 21st century',
    journal: 'GCB Bioenergy',
    volume: '12', pages: '287–305',
    doi: '10.1111/gcbb.12671',
    open: true
  },

  song_2012: {
    authors: ['Song, Y.', 'Jain, A.K.', 'Landuyt, W.', 'Kheshgi, H.S.', 'Khanna, M.'],
    year: 2015,
    title: 'Estimates of biomass yield for perennial bioenergy grasses in the USA',
    journal: 'BioEnergy Research',
    volume: '8', pages: '688–715',
    doi: '10.1007/s12155-014-9546-1',
    note: 'The folder is named song_2012 after the 2001–2012 simulation period, but the paper appeared in 2015 (online November 2014). Cite it as 2015.'
  },

  vanloocke_2010: {
    authors: ['VanLoocke, A.', 'Bernacchi, C.J.', 'Twine, T.E.'],
    year: 2010,
    title: 'The impacts of Miscanthus × giganteus production on the Midwest US hydrologic cycle',
    journal: 'GCB Bioenergy',
    volume: '2', pages: '180–191',
    doi: '10.1111/j.1757-1707.2010.01053.x'
  },

  vanloocke_2012: {
    authors: ['VanLoocke, A.', 'Twine, T.E.', 'Zeri, M.', 'Bernacchi, C.J.'],
    year: 2012,
    title: 'A regional comparison of water use efficiency for miscanthus, switchgrass and maize',
    journal: 'Agricultural and Forest Meteorology',
    volume: '164', pages: '82–95',
    doi: '10.1016/j.agrformet.2012.05.016'
  },

  zhuang_2013: {
    authors: ['Zhuang, Q.', 'Qin, Z.', 'Chen, M.'],
    year: 2013,
    title: 'Biofuel, land and water: maize, switchgrass or Miscanthus?',
    journal: 'Environmental Research Letters',
    volume: '8', pages: '015020',
    doi: '10.1088/1748-9326/8/1/015020',
    open: true
  }
};
