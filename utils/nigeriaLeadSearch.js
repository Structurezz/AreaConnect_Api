// Search parameters for AI lead generation across all of Nigeria.
// States are grouped by geopolitical zone; each lists the cities/areas where
// gated estates and property companies are concentrated.

const ZONES = {
  south_west:    'South West',
  south_south:   'South South',
  south_east:    'South East',
  north_central: 'North Central',
  north_west:    'North West',
  north_east:    'North East',
};

const STATES = [
  // South West
  { name: 'Lagos',       zone: 'south_west',    cities: ['Lekki', 'Ikoyi', 'Victoria Island', 'Ajah', 'Ikeja', 'Magodo', 'Gbagada', 'Surulere', 'Ibeju-Lekki'] },
  { name: 'Ogun',        zone: 'south_west',    cities: ['Abeokuta', 'Sagamu', 'Mowe', 'Ibafo', 'Ota', 'Ijebu-Ode'] },
  { name: 'Oyo',         zone: 'south_west',    cities: ['Ibadan', 'Ogbomoso', 'Oyo'] },
  { name: 'Osun',        zone: 'south_west',    cities: ['Osogbo', 'Ile-Ife', 'Ilesa'] },
  { name: 'Ondo',        zone: 'south_west',    cities: ['Akure', 'Ondo', 'Owo'] },
  { name: 'Ekiti',       zone: 'south_west',    cities: ['Ado-Ekiti', 'Ikere'] },
  // South South
  { name: 'Rivers',      zone: 'south_south',   cities: ['Port Harcourt', 'Obio-Akpor', 'Eleme'] },
  { name: 'Delta',       zone: 'south_south',   cities: ['Asaba', 'Warri', 'Ughelli', 'Sapele'] },
  { name: 'Edo',         zone: 'south_south',   cities: ['Benin City', 'Auchi', 'Ekpoma'] },
  { name: 'Akwa Ibom',   zone: 'south_south',   cities: ['Uyo', 'Eket', 'Ikot Ekpene'] },
  { name: 'Cross River', zone: 'south_south',   cities: ['Calabar', 'Ikom'] },
  { name: 'Bayelsa',     zone: 'south_south',   cities: ['Yenagoa'] },
  // South East
  { name: 'Enugu',       zone: 'south_east',    cities: ['Enugu', 'Nsukka'] },
  { name: 'Anambra',     zone: 'south_east',    cities: ['Awka', 'Onitsha', 'Nnewi'] },
  { name: 'Imo',         zone: 'south_east',    cities: ['Owerri', 'Orlu', 'Okigwe'] },
  { name: 'Abia',        zone: 'south_east',    cities: ['Umuahia', 'Aba'] },
  { name: 'Ebonyi',      zone: 'south_east',    cities: ['Abakaliki'] },
  // North Central
  { name: 'FCT',         zone: 'north_central', cities: ['Abuja', 'Maitama', 'Asokoro', 'Gwarinpa', 'Lugbe', 'Jabi', 'Wuse', 'Kubwa'] },
  { name: 'Niger',       zone: 'north_central', cities: ['Minna', 'Suleja', 'Bida'] },
  { name: 'Nasarawa',    zone: 'north_central', cities: ['Lafia', 'Karu', 'Keffi'] },
  { name: 'Kwara',       zone: 'north_central', cities: ['Ilorin', 'Offa'] },
  { name: 'Kogi',        zone: 'north_central', cities: ['Lokoja', 'Okene'] },
  { name: 'Plateau',     zone: 'north_central', cities: ['Jos', 'Bukuru'] },
  { name: 'Benue',       zone: 'north_central', cities: ['Makurdi', 'Gboko', 'Otukpo'] },
  // North West
  { name: 'Kano',        zone: 'north_west',    cities: ['Kano', 'Nassarawa GRA'] },
  { name: 'Kaduna',      zone: 'north_west',    cities: ['Kaduna', 'Zaria', 'Kafanchan'] },
  { name: 'Katsina',     zone: 'north_west',    cities: ['Katsina', 'Funtua', 'Daura'] },
  { name: 'Sokoto',      zone: 'north_west',    cities: ['Sokoto'] },
  { name: 'Kebbi',       zone: 'north_west',    cities: ['Birnin Kebbi'] },
  { name: 'Zamfara',     zone: 'north_west',    cities: ['Gusau'] },
  { name: 'Jigawa',      zone: 'north_west',    cities: ['Dutse', 'Hadejia'] },
  // North East
  { name: 'Bauchi',      zone: 'north_east',    cities: ['Bauchi', 'Azare'] },
  { name: 'Gombe',       zone: 'north_east',    cities: ['Gombe'] },
  { name: 'Adamawa',     zone: 'north_east',    cities: ['Yola', 'Mubi'] },
  { name: 'Borno',       zone: 'north_east',    cities: ['Maiduguri'] },
  { name: 'Taraba',      zone: 'north_east',    cities: ['Jalingo'] },
  { name: 'Yobe',        zone: 'north_east',    cities: ['Damaturu', 'Potiskum'] },
];

const LEAD_TYPES = {
  developer:        { label: 'Estate Developers',      search: 'real estate developer / gated estate developer' },
  estate_manager:   { label: 'Estate & Facility Managers', search: 'estate management / facility management company' },
  property_company: { label: 'Property Companies',     search: 'property company / realtor / real estate firm' },
  investment_firm:  { label: 'Investment Firms',       search: 'real estate investment firm / REIT' },
  government:       { label: 'Housing Agencies',       search: 'state housing corporation / housing agency' },
  residents_assoc:  { label: 'Residents Associations', search: 'estate residents association / landlords association (CDA)' },
};

const ROLES = ['CEO', 'Managing Director', 'Founder', 'Director', 'Estate Manager', 'Facility Manager', 'Head of Operations', 'Chairman'];

// city (lowercased) → state name, for back-filling state on older prospects
const CITY_TO_STATE = {};
for (const s of STATES) {
  CITY_TO_STATE[s.name.toLowerCase()] = s.name;
  for (const c of s.cities) CITY_TO_STATE[c.toLowerCase()] = s.name;
}
CITY_TO_STATE['abuja'] = 'FCT';
CITY_TO_STATE['port harcourt'] = 'Rivers';

const stateForCity = (city = '') => CITY_TO_STATE[String(city).trim().toLowerCase()] || '';

const findState = (name = '') =>
  STATES.find(s => s.name.toLowerCase() === String(name).trim().toLowerCase());

module.exports = { ZONES, STATES, LEAD_TYPES, ROLES, stateForCity, findState };
