// Query for a site's managers. A manager is linked either through their main
// site (estateId) or, when they run several sites, through managedEstates —
// lookups by estateId alone miss multi-site managers.
const managerQuery = (estateId) => ({ role: 'estate_manager', $or: [{ estateId }, { managedEstates: estateId }] });

module.exports = { managerQuery };
