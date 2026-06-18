const Prospect = require('../models/Prospect');
const { sendPitchEmail } = require('../services/emailService');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Seed data ──────────────────────────────────────────────────────────────────
const SEED_PROSPECTS = [
  { name: 'Adewale Okonkwo',      company: 'Eleganza Estates Ltd',          email: 'adewale@eleganzaestates.ng',       phone: '0803 001 0001', city: 'Lagos',         type: 'developer'        },
  { name: 'Chukwuemeka Eze',      company: 'Sunrise Realty Nigeria',         email: 'emeka@sunriserealty.ng',           phone: '0803 001 0002', city: 'Lagos',         type: 'property_company' },
  { name: 'Fatima Abdullahi',     company: 'Apex Property Group',            email: 'fatima@apexproperty.ng',           phone: '0803 001 0003', city: 'Abuja',         type: 'developer'        },
  { name: 'Emeka Obiora',         company: 'Greenfield Homes Ltd',           email: 'emeka@greenfieldhomes.ng',         phone: '0803 001 0004', city: 'Enugu',         type: 'estate_manager'   },
  { name: 'Ngozi Okafor',         company: 'Prime Realty Solutions',         email: 'ngozi@primeresalty.ng',            phone: '0803 001 0005', city: 'Lagos',         type: 'property_company' },
  { name: 'Ibrahim Musa',         company: 'Northern Crescent Properties',   email: 'ibrahim@ncproperties.ng',          phone: '0803 001 0006', city: 'Kano',          type: 'developer'        },
  { name: 'Aisha Garba',          company: 'Royal Heritage Estates',         email: 'aisha@royalheritage.ng',           phone: '0803 001 0007', city: 'Abuja',         type: 'estate_manager'   },
  { name: 'Chidi Aneke',          company: 'Aneke Property Management',      email: 'chidi@anekeproperty.ng',           phone: '0803 001 0008', city: 'Port Harcourt', type: 'estate_manager'   },
  { name: 'Bola Adekunle',        company: 'Adekunle & Sons Developers',     email: 'bola@adekunledev.ng',              phone: '0803 001 0009', city: 'Ibadan',        type: 'developer'        },
  { name: 'Kemi Adeyemi',         company: 'CityView Properties',            email: 'kemi@cityviewprops.ng',            phone: '0803 001 0010', city: 'Lagos',         type: 'property_company' },
  { name: 'Tunde Fashola',        company: 'Metro Homes Nigeria',            email: 'tunde@metrohomes.ng',              phone: '0803 001 0011', city: 'Lagos',         type: 'developer'        },
  { name: 'Amaka Nwosu',          company: 'Nwosu Real Estate Consortium',   email: 'amaka@nwosurealty.ng',             phone: '0803 001 0012', city: 'Onitsha',       type: 'property_company' },
  { name: 'Yakubu Hassan',        company: 'Sahel Property Investments',     email: 'yakubu@sahelproperty.ng',          phone: '0803 001 0013', city: 'Kaduna',        type: 'investment_firm'  },
  { name: 'Seun Adesanya',        company: 'Adesanya Estates & Facilities',  email: 'seun@adesanyaestates.ng',          phone: '0803 001 0014', city: 'Abeokuta',      type: 'estate_manager'   },
  { name: 'Dike Obi',             company: 'Eastern Gateway Developers',     email: 'dike@easterngateway.ng',           phone: '0803 001 0015', city: 'Owerri',        type: 'developer'        },
  { name: 'Hauwa Usman',          company: 'Capital Axis Properties',        email: 'hauwa@capitalaxis.ng',             phone: '0803 001 0016', city: 'Abuja',         type: 'property_company' },
  { name: 'Yemi Badmus',          company: 'Badmus & Partners Realty',       email: 'yemi@badmuspartners.ng',           phone: '0803 001 0017', city: 'Lagos',         type: 'property_company' },
  { name: 'Gbenga Olowole',       company: 'Olowole Housing Corporation',    email: 'gbenga@olowolehousing.ng',         phone: '0803 001 0018', city: 'Ile-Ife',       type: 'developer'        },
  { name: 'Chiamaka Onyekwere',   company: 'Onyekwere Premium Estates',      email: 'chiamaka@onyekwereestates.ng',     phone: '0803 001 0019', city: 'Asaba',         type: 'estate_manager'   },
  { name: 'Musa Aliyu',           company: 'Aliyu Property Trust',           email: 'musa@aliyutrust.ng',               phone: '0803 001 0020', city: 'Zaria',         type: 'investment_firm'  },
  { name: 'Lola Coker',           company: 'Coker Real Estate Group',        email: 'lola@cokerrealestate.ng',          phone: '0803 001 0021', city: 'Lagos',         type: 'property_company' },
  { name: 'Femi Osunbade',        company: 'Osunbade Properties & Dev',      email: 'femi@osunbadeprops.ng',            phone: '0803 001 0022', city: 'Ekiti',         type: 'developer'        },
  { name: 'Nkem Okonkwo',         company: 'Okonkwo Facility Management',    email: 'nkem@okonkwofm.ng',                phone: '0803 001 0023', city: 'Port Harcourt', type: 'estate_manager'   },
  { name: 'Abdullahi Yusuf',      company: 'Yusuf Landmark Developers',      email: 'abdullahi@yusuflandmark.ng',       phone: '0803 001 0024', city: 'Maiduguri',     type: 'developer'        },
  { name: 'Ify Nzeka',            company: 'Nzeka Premium Residentials',     email: 'ify@nzekaresidential.ng',          phone: '0803 001 0025', city: 'Abuja',         type: 'property_company' },
  { name: 'Remi Adebayo',         company: 'Adebayo Integrated Properties',  email: 'remi@adebayoprops.ng',             phone: '0803 001 0026', city: 'Osogbo',        type: 'estate_manager'   },
  { name: 'Uche Nwankwo',         company: 'Nwankwo Realty & Construction',  email: 'uche@nwankoworealty.ng',           phone: '0803 001 0027', city: 'Enugu',         type: 'developer'        },
  { name: 'Hadiza Bello',         company: 'Bello Crown Properties',         email: 'hadiza@bellocrown.ng',             phone: '0803 001 0028', city: 'Abuja',         type: 'property_company' },
  { name: 'Lanre Ogundimu',       company: 'Ogundimu Estate Managers',       email: 'lanre@ogundimuem.ng',              phone: '0803 001 0029', city: 'Ibadan',        type: 'estate_manager'   },
  { name: 'Chinwe Okeke',         company: 'Okeke Urban Developments',       email: 'chinwe@okekeurban.ng',             phone: '0803 001 0030', city: 'Onitsha',       type: 'developer'        },
  { name: 'Dauda Ibrahim',        company: 'Ibrahim Properties Ltd',         email: 'dauda@ibrahimprops.ng',            phone: '0803 001 0031', city: 'Kano',          type: 'property_company' },
  { name: 'Peju Ojo',             company: 'Ojo Real Estate Ventures',       email: 'peju@ojorealestate.ng',            phone: '0803 001 0032', city: 'Lagos',         type: 'property_company' },
  { name: 'Obinna Agwu',          company: 'Agwu Luxury Estates',            email: 'obinna@agwuluxury.ng',             phone: '0803 001 0033', city: 'Owerri',        type: 'estate_manager'   },
  { name: 'Suwebat Afolabi',      company: 'Afolabi Premium Properties',     email: 'suwebat@afolabiprops.ng',          phone: '0803 001 0034', city: 'Lagos',         type: 'property_company' },
  { name: 'Hakeem Lawal',         company: 'Lawal & Co. Property Managers',  email: 'hakeem@lawalproperty.ng',          phone: '0803 001 0035', city: 'Lagos',         type: 'estate_manager'   },
  { name: 'Grace Obiechina',      company: 'Obiechina Residential Trust',    email: 'grace@obiechinaresidential.ng',    phone: '0803 001 0036', city: 'Awka',          type: 'investment_firm'  },
  { name: 'Suleiman Garba',       company: 'Garba Property Holdings',        email: 'suleiman@garbaproperty.ng',        phone: '0803 001 0037', city: 'Kaduna',        type: 'investment_firm'  },
  { name: 'Tayo Akinlade',        company: 'Akinlade Homes & Facilities',    email: 'tayo@akinladehomes.ng',            phone: '0803 001 0038', city: 'Akure',         type: 'estate_manager'   },
  { name: 'Ngozi Anyanwu',        company: 'Anyanwu Property Consultants',   email: 'ngozi@anyanwuproperty.ng',         phone: '0803 001 0039', city: 'Aba',           type: 'property_company' },
  { name: 'Alhaji Bello',         company: 'Bello Integrated Estates',       email: 'alhaji@bellocrown.ng',             phone: '0803 001 0040', city: 'Abuja',         type: 'developer'        },
  { name: 'Chika Odum',           company: 'Odum Estate & Housing',          email: 'chika@odumestates.ng',             phone: '0803 001 0041', city: 'Enugu',         type: 'estate_manager'   },
  { name: 'Biodun Omotosho',      company: 'Omotosho Premium Living',        email: 'biodun@omotoshopremium.ng',        phone: '0803 001 0042', city: 'Lagos',         type: 'developer'        },
  { name: 'Kabiru Mohammed',      company: 'Mohammed Property Network',      email: 'kabiru@mohammedproperty.ng',       phone: '0803 001 0043', city: 'Kano',          type: 'estate_manager'   },
  { name: 'Adaora Nwachukwu',     company: 'Nwachukwu Realty Consortium',    email: 'adaora@nwachukwurealty.ng',        phone: '0803 001 0044', city: 'Port Harcourt', type: 'property_company' },
  { name: 'Festus Omolade',       company: 'Omolade & Associates Estates',   email: 'festus@omoladeassociates.ng',      phone: '0803 001 0045', city: 'Benin City',    type: 'developer'        },
  { name: 'Ifeoma Ukwu',          company: 'Ukwu Holdings Property',         email: 'ifeoma@ukwuholdings.ng',           phone: '0803 001 0046', city: 'Onitsha',       type: 'investment_firm'  },
  { name: 'Audu Salisu',          company: 'Salisu Premier Properties',      email: 'audu@salisuproperties.ng',         phone: '0803 001 0047', city: 'Sokoto',        type: 'developer'        },
  { name: 'Titilayo Babalola',    company: 'Babalola Housing Partners',      email: 'titi@babolahousing.ng',            phone: '0803 001 0048', city: 'Ibadan',        type: 'property_company' },
  { name: 'Emeka Ikenna',         company: 'Ikenna Luxury Apartments',       email: 'emeka@ikennaluxury.ng',            phone: '0803 001 0049', city: 'Lagos',         type: 'developer'        },
  { name: 'Zainab Yusuf',         company: 'Yusuf & Co. Estate Managers',    email: 'zainab@yusufestates.ng',           phone: '0803 001 0050', city: 'Abuja',         type: 'estate_manager'   },
  { name: 'Rotimi Adesola',       company: 'Adesola Integrated Homes',       email: 'rotimi@adesola-homes.ng',          phone: '0803 001 0051', city: 'Lekki',         type: 'developer'        },
  { name: 'Priscilla Okafor',     company: 'Okafor Residential Services',    email: 'priscilla@okaforresidential.ng',   phone: '0803 001 0052', city: 'Enugu',         type: 'estate_manager'   },
  { name: 'Nuhu Tanko',           company: 'Tanko Property & Investment',    email: 'nuhu@tankoproperty.ng',            phone: '0803 001 0053', city: 'Jos',           type: 'investment_firm'  },
  { name: 'Adeola Adetoye',       company: 'Adetoye Family Estates',         email: 'adeola@adetoye-estates.ng',        phone: '0803 001 0054', city: 'Lagos',         type: 'estate_manager'   },
  { name: 'Nnamdi Obi',           company: 'Obi Urban Planners Ltd',         email: 'nnamdi@obiurban.ng',               phone: '0803 001 0055', city: 'Abuja',         type: 'developer'        },
  { name: 'Mariam Yaro',          company: 'Yaro Crown Residentials',        email: 'mariam@yarocrown.ng',              phone: '0803 001 0056', city: 'Minna',         type: 'property_company' },
  { name: 'Kayode Adeleke',       company: 'Adeleke Mega Properties',        email: 'kayode@adelekemega.ng',            phone: '0803 001 0057', city: 'Osogbo',        type: 'developer'        },
  { name: 'Christiana Nwofor',    company: 'Nwofor Property Solutions',      email: 'christiana@nwoforprops.ng',        phone: '0803 001 0058', city: 'Asaba',         type: 'property_company' },
  { name: 'Mu\'azu Dansarki',     company: 'Dansarki Prime Estates',         email: 'muazu@dansarki.ng',                phone: '0803 001 0059', city: 'Bauchi',        type: 'developer'        },
  { name: 'Gbemi Akindele',       company: 'Akindele Premium Realty',        email: 'gbemi@akindelerealty.ng',          phone: '0803 001 0060', city: 'Lagos',         type: 'property_company' },
  { name: 'Obiageli Eze',         company: 'Eze Housing & Estate Trust',     email: 'obiageli@eze-housing.ng',          phone: '0803 001 0061', city: 'Awka',          type: 'estate_manager'   },
  { name: 'Adeyemi Okuneye',      company: 'Okuneye Horizon Estates',        email: 'adeyemi@okuneyehorizon.ng',        phone: '0803 001 0062', city: 'Lagos',         type: 'developer'        },
  { name: 'Halima Umar',          company: 'Umar & Sons Real Estate',        email: 'halima@umarrealestate.ng',         phone: '0803 001 0063', city: 'Kano',          type: 'property_company' },
  { name: 'Chinedu Okonkwo',      company: 'Okonkwo Smart Living',           email: 'chinedu@okonkwosmartliving.ng',    phone: '0803 001 0064', city: 'Lagos',         type: 'developer'        },
  { name: 'Oluwakemi Peters',     company: 'Peters Property Network',        email: 'kemi@petersproperty.ng',           phone: '0803 001 0065', city: 'Ibadan',        type: 'estate_manager'   },
  { name: 'Mohammed Alkali',      company: 'Alkali Commercial Properties',   email: 'mohammed@alkaliproperty.ng',       phone: '0803 001 0066', city: 'Abuja',         type: 'investment_firm'  },
  { name: 'Adunola Bello',        company: 'Bello Prestige Living',          email: 'adunola@belloprestige.ng',         phone: '0803 001 0067', city: 'Lagos',         type: 'developer'        },
  { name: 'Uzoma Dike',           company: 'Dike & Associates Estates',      email: 'uzoma@dikeassociates.ng',          phone: '0803 001 0068', city: 'Port Harcourt', type: 'estate_manager'   },
  { name: 'Fatimah Suleiman',     company: 'Suleiman Comfort Realty',        email: 'fatimah@suleimanrealty.ng',        phone: '0803 001 0069', city: 'Abuja',         type: 'property_company' },
  { name: 'Funke Sotunde',        company: 'Sotunde Residential Group',      email: 'funke@sotunderesidential.ng',      phone: '0803 001 0070', city: 'Lagos',         type: 'developer'        },
  { name: 'Chukwudi Nwosu',       company: 'Nwosu Signature Estates',        email: 'chukwudi@nwosusignature.ng',       phone: '0803 001 0071', city: 'Enugu',         type: 'estate_manager'   },
  { name: 'Bashir Modibbo',       company: 'Modibbo Prime Developers',       email: 'bashir@modibbodev.ng',             phone: '0803 001 0072', city: 'Adamawa',       type: 'developer'        },
  { name: 'Tosin Awoyemi',        company: 'Awoyemi Property Consultants',   email: 'tosin@awoyemiproperty.ng',         phone: '0803 001 0073', city: 'Abeokuta',      type: 'property_company' },
  { name: 'Onyeka Ike',           company: 'Ike Estate Managers',            email: 'onyeka@ikeestates.ng',             phone: '0803 001 0074', city: 'Owerri',        type: 'estate_manager'   },
  { name: 'Olabisi Aremu',        company: 'Aremu Homes & Properties',       email: 'olabisi@aremuhomes.ng',            phone: '0803 001 0075', city: 'Ilorin',        type: 'developer'        },
  { name: 'Haruna Idris',         company: 'Idris Landmark Properties',      email: 'haruna@idrislandmark.ng',          phone: '0803 001 0076', city: 'Kaduna',        type: 'developer'        },
  { name: 'Chioma Ezeagwu',       company: 'Ezeagwu & Partners Realty',     email: 'chioma@ezeagwurealty.ng',          phone: '0803 001 0077', city: 'Aba',           type: 'property_company' },
  { name: 'Afolabi Oluwole',      company: 'Oluwole Smart Estates',          email: 'afolabi@oluwolesmarest.ng',        phone: '0803 001 0078', city: 'Lagos',         type: 'estate_manager'   },
  { name: 'Nkechi Obi',           company: 'Obi Family Properties',          email: 'nkechi@obifamily.ng',              phone: '0803 001 0079', city: 'Enugu',         type: 'property_company' },
  { name: 'Adetutu Adeola',       company: 'Adeola Crown Residences',        email: 'adetutu@adeolacrown.ng',           phone: '0803 001 0080', city: 'Abuja',         type: 'developer'        },
  { name: 'Maikudi Dantata',      company: 'Dantata Properties Kano',        email: 'maikudi@dantataprops.ng',          phone: '0803 001 0081', city: 'Kano',          type: 'investment_firm'  },
  { name: 'Vivian Osuji',         company: 'Osuji Prestige Estates',         email: 'vivian@osujiprestige.ng',          phone: '0803 001 0082', city: 'Port Harcourt', type: 'developer'        },
  { name: 'Damilola Adejumo',     company: 'Adejumo Property Services',      email: 'damilola@adejumoproperty.ng',      phone: '0803 001 0083', city: 'Ibadan',        type: 'estate_manager'   },
  { name: 'Ishaq Balogun',        company: 'Balogun Real Estate Group',      email: 'ishaq@balounrealestate.ng',        phone: '0803 001 0084', city: 'Lagos',         type: 'property_company' },
  { name: 'Roseline Ugwu',        company: 'Ugwu Premium Residences',        email: 'roseline@ugwupremium.ng',          phone: '0803 001 0085', city: 'Enugu',         type: 'estate_manager'   },
  { name: 'Tijani Olatunji',      company: 'Olatunji Estate Holdings',       email: 'tijani@olatunjihodes.ng',          phone: '0803 001 0086', city: 'Lagos',         type: 'investment_firm'  },
  { name: 'Miracle Okonkwo',      company: 'Okonkwo Future Estates',         email: 'miracle@okonkwofuture.ng',         phone: '0803 001 0087', city: 'Lagos',         type: 'developer'        },
  { name: 'Nasiru Wada',          company: 'Wada Property Developers',       email: 'nasiru@wadaprops.ng',              phone: '0803 001 0088', city: 'Katsina',       type: 'developer'        },
  { name: 'Adenike Olawale',      company: 'Olawale Housing Solutions',      email: 'adenike@olawalehousing.ng',        phone: '0803 001 0089', city: 'Abeokuta',      type: 'property_company' },
  { name: 'Ugochi Amadi',         company: 'Amadi Signature Living',         email: 'ugochi@amadisignature.ng',         phone: '0803 001 0090', city: 'Port Harcourt', type: 'developer'        },
  { name: 'Abubakar Sadiq',       company: 'Sadiq Highlands Properties',     email: 'sadiq@sadiqhighlands.ng',          phone: '0803 001 0091', city: 'Abuja',         type: 'property_company' },
  { name: 'Oge Anene',            company: 'Anene Properties & Management',  email: 'oge@aneneprops.ng',                phone: '0803 001 0092', city: 'Onitsha',       type: 'estate_manager'   },
  { name: 'Fola Odeyemi',         company: 'Odeyemi Realty Partners',        email: 'fola@odeyemirealty.ng',            phone: '0803 001 0093', city: 'Lagos',         type: 'property_company' },
  { name: 'Sunday Ekwueme',       company: 'Ekwueme Urban Developers',       email: 'sunday@ekwuemeurban.ng',           phone: '0803 001 0094', city: 'Anambra',       type: 'developer'        },
  { name: 'Khadija Sani',         company: 'Sani Luxury Residences',         email: 'khadija@saniluxury.ng',            phone: '0803 001 0095', city: 'Abuja',         type: 'developer'        },
  { name: 'Olumide Fadare',       company: 'Fadare Property Investments',    email: 'olumide@fadareprops.ng',           phone: '0803 001 0096', city: 'Lagos',         type: 'investment_firm'  },
  { name: 'Comfort Okon',         company: 'Okon Estate & Housing Ltd',      email: 'comfort@okon-estates.ng',          phone: '0803 001 0097', city: 'Calabar',       type: 'estate_manager'   },
  { name: 'Garba Abba',           company: 'Abba Landmark Developers',       email: 'garba@abbalandmark.ng',            phone: '0803 001 0098', city: 'Borno',         type: 'developer'        },
  { name: 'Nneka Obi-Eze',        company: 'Obi-Eze Premium Residentials',   email: 'nneka@obi-ezepremium.ng',          phone: '0803 001 0099', city: 'Owerri',        type: 'property_company' },
  { name: 'Omotayo Aderemi',      company: 'Aderemi & Associates Properties',email: 'omotayo@aderemiassociates.ng',     phone: '0803 001 0100', city: 'Lagos',         type: 'estate_manager'   },
];

// ── Controller functions ───────────────────────────────────────────────────────

exports.seedProspects = async (req, res) => {
  try {
    const count = await Prospect.countDocuments();
    if (count > 0) {
      return res.json({ success: true, message: `Already seeded (${count} prospects exist)`, count });
    }
    await Prospect.insertMany(SEED_PROSPECTS);
    return res.json({ success: true, message: `Seeded ${SEED_PROSPECTS.length} prospects`, count: SEED_PROSPECTS.length });
  } catch (err) {
    console.error('[seed prospects]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getProspects = async (req, res) => {
  try {
    // Auto-seed if empty
    const count = await Prospect.countDocuments();
    if (count === 0) {
      await Prospect.insertMany(SEED_PROSPECTS);
    }

    const { status, type, search, page = 1, limit = 200 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type)   filter.type   = type;
    if (search) {
      filter.$or = [
        { name:    { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { email:   { $regex: search, $options: 'i' } },
        { city:    { $regex: search, $options: 'i' } },
      ];
    }

    const prospects = await Prospect.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Prospect.countDocuments(filter);
    return res.json({ success: true, data: prospects, total });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateProspect = async (req, res) => {
  try {
    const prospect = await Prospect.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!prospect) return res.status(404).json({ success: false, message: 'Prospect not found' });
    return res.json({ success: true, data: prospect });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteProspect = async (req, res) => {
  try {
    await Prospect.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Prospect deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendPitchEmails = async (req, res) => {
  try {
    const { prospectIds } = req.body; // array of ids, or 'all'
    let prospects;
    if (prospectIds === 'all') {
      prospects = await Prospect.find({ status: { $ne: 'declined' } });
    } else if (Array.isArray(prospectIds) && prospectIds.length > 0) {
      prospects = await Prospect.find({ _id: { $in: prospectIds } });
    } else {
      return res.status(400).json({ success: false, message: 'No prospects selected' });
    }

    if (prospects.length === 0) {
      return res.status(400).json({ success: false, message: 'No matching prospects found' });
    }

    const results = { sent: 0, failed: 0, skipped: 0 };
    const now = new Date();

    for (const prospect of prospects) {
      try {
        const result = await sendPitchEmail({
          to: prospect.email,
          name: prospect.name,
          company: prospect.company,
          city: prospect.city,
        });

        if (result?.skipped) {
          results.skipped++;
        } else {
          results.sent++;
          await Prospect.findByIdAndUpdate(prospect._id, { status: 'contacted', emailSentAt: now });
        }
      } catch (e) {
        console.error('[pitch email]', prospect.email, e.message);
        results.failed++;
      }
    }

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error('[sendPitchEmails]', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.generateProspects = async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ success: false, message: 'Gemini API key not configured' });
    }

    const { count = 25 } = req.body;
    const batchSize = Math.min(Math.max(Number(count) || 25, 5), 50);

    const existingEmails    = await Prospect.distinct('email');
    const existingCompanies = await Prospect.distinct('company');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Use Google Search grounding so Gemini pulls real companies from the web
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ googleSearch: {} }],
    });

    const searchQueries = [
      'Nigerian real estate developers companies Lagos Abuja 2024 contact email',
      'property management companies Nigeria estate managers contact details',
      'Nigerian gated estate developers directors contact email Port Harcourt Enugu',
      'real estate investment firms Nigeria Kano Ibadan Benin City contacts',
    ];
    const chosenQuery = searchQueries[Math.floor(Math.random() * searchQueries.length)];

    const prompt = `Search the web for: "${chosenQuery}"

Using what you find, extract ${batchSize} REAL Nigerian property companies and their real publicly listed contact persons.
Only use information you actually find on the web — real company names, real people's names, real emails/phones from their official websites, LinkedIn, or business directories.

Do NOT include any of these already-known companies: ${existingCompanies.slice(0, 20).join(', ')}.

Return ONLY a valid JSON array (no markdown, no code fences, no explanation). Each object must have exactly:
{
  "name": "Real person's full name (director, manager, CEO, or contact person)",
  "company": "Real company name exactly as listed",
  "email": "Real email address found publicly (use info@, contact@, or personal if found)",
  "phone": "Real phone number if found, else empty string",
  "city": "City where company is based",
  "type": one of ["developer", "estate_manager", "property_company", "investment_firm", "government"],
  "website": "Company's official website URL (e.g. https://companyname.com)",
  "source": "URL or page where this info was found"
}

If you cannot find a real email for a company, construct the most likely one from their domain (e.g. info@companyname.com) but mark it clearly. Prioritise real contacts over guesses.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip markdown fences if present
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let generated;
    try {
      generated = JSON.parse(jsonText);
    } catch (parseErr) {
      // Try to extract JSON array from mixed text
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        try { generated = JSON.parse(match[0]); }
        catch { generated = null; }
      }
      if (!generated) {
        console.error('[generateProspects] parse error:', parseErr.message, '\nRaw:', text.slice(0, 400));
        return res.status(500).json({ success: false, message: 'AI returned invalid JSON. Try again.' });
      }
    }

    if (!Array.isArray(generated)) {
      return res.status(500).json({ success: false, message: 'AI returned unexpected format. Try again.' });
    }

    const VALID_TYPES = ['developer','estate_manager','property_company','investment_firm','government'];

    const newProspects = generated.filter(p =>
      p.email && p.name && p.company &&
      !existingEmails.includes(p.email.toLowerCase())
    ).map(p => ({
      name:    p.name,
      company: p.company,
      email:   p.email.toLowerCase().trim(),
      phone:   p.phone   || '',
      city:    p.city    || '',
      website: p.website || '',
      type:    VALID_TYPES.includes(p.type) ? p.type : 'estate_manager',
      notes:   p.source ? `Source: ${p.source}` : '',
      status:  'new',
    }));

    if (newProspects.length === 0) {
      return res.json({ success: true, added: 0, message: 'No new unique prospects found. Try again for a different batch.' });
    }

    await Prospect.insertMany(newProspects, { ordered: false });
    const newTotal = await Prospect.countDocuments();

    console.log(`[generateProspects] Added ${newProspects.length} real prospects. Total: ${newTotal}`);
    return res.json({ success: true, added: newProspects.length, total: newTotal, data: newProspects });
  } catch (err) {
    console.error('[generateProspects]', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Generation failed' });
  }
};

exports.getProspectStats = async (req, res) => {
  try {
    const [total, contacted, interested, converted, declined] = await Promise.all([
      Prospect.countDocuments(),
      Prospect.countDocuments({ status: 'contacted' }),
      Prospect.countDocuments({ status: 'interested' }),
      Prospect.countDocuments({ status: 'converted' }),
      Prospect.countDocuments({ status: 'declined' }),
    ]);

    const byCity = await Prospect.aggregate([
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const byType = await Prospect.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);

    return res.json({
      success: true,
      data: { total, contacted, interested, converted, declined, byCity, byType },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
