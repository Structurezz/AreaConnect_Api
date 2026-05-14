const MarketplaceListing = require('../models/MarketplaceListing');

exports.getListings = async (req, res) => {
  try {
    const { category, status = 'active', page = 1, limit = 20 } = req.query;
    const filter = { estateId: req.estateId, status };
    if (category) filter.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [listings, total] = await Promise.all([
      MarketplaceListing.find(filter)
        .populate('sellerId', 'name profilePhoto phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MarketplaceListing.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: listings,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createListing = async (req, res) => {
  try {
    const { title, description, price, category, contactPhone } = req.body;
    const images = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

    const listing = await MarketplaceListing.create({
      estateId: req.estateId,
      sellerId: req.user._id,
      title,
      description,
      price: parseFloat(price),
      category,
      contactPhone: contactPhone || req.user.phone,
      images,
      status: 'active',
    });

    await listing.populate('sellerId', 'name profilePhoto phone');
    return res.status(201).json({ success: true, data: listing });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateListing = async (req, res) => {
  try {
    const { title, description, price, category, status, contactPhone } = req.body;

    const listing = await MarketplaceListing.findOne({
      _id: req.params.id,
      estateId: req.estateId,
    });
    if (!listing) return res.status(404).json({ success: false, message: 'Not found' });

    const isOwner = listing.sellerId.toString() === req.user._id.toString();
    const isManager = ['estate_manager', 'super_admin'].includes(req.user.role);
    if (!isOwner && !isManager) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    Object.assign(listing, { title, description, price, category, status, contactPhone });
    await listing.save();

    return res.json({ success: true, data: listing });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteListing = async (req, res) => {
  try {
    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!listing) return res.status(404).json({ success: false, message: 'Not found' });

    const isOwner = listing.sellerId.toString() === req.user._id.toString();
    const isManager = ['estate_manager', 'super_admin'].includes(req.user.role);
    if (!isOwner && !isManager) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await listing.deleteOne();
    return res.json({ success: true, message: 'Listing deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.viewListing = async (req, res) => {
  try {
    const listing = await MarketplaceListing.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    ).populate('sellerId', 'name profilePhoto phone');
    if (!listing) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: listing });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
