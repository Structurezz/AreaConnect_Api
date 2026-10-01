const MarketplaceListing = require('../models/MarketplaceListing');

exports.getListings = async (req, res) => {
  try {
    const { category, status = 'active', page = 1, limit = 20, q, condition, minPrice, maxPrice, sort = 'newest' } = req.query;
    const filter = { estateId: req.estateId, status };
    if (category) filter.category = category;
    if (condition) filter.condition = condition;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }
    if (q) filter.$text = { $search: q };

    const sortMap = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, price_asc: { price: 1 }, price_desc: { price: -1 }, popular: { views: -1 } };
    const sortObj = sortMap[sort] || { createdAt: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [listings, total] = await Promise.all([
      MarketplaceListing.find(filter)
        .populate('sellerId', 'name profilePhoto phone')
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit)),
      MarketplaceListing.countDocuments(filter),
    ]);

    return res.json({ success: true, data: listings, pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getMyListings = async (req, res) => {
  try {
    const listings = await MarketplaceListing.find({ estateId: req.estateId, sellerId: req.user._id })
      .populate('sellerId', 'name profilePhoto phone')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: listings });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getSaved = async (req, res) => {
  try {
    const listings = await MarketplaceListing.find({ estateId: req.estateId, savedBy: req.user._id, status: 'active' })
      .populate('sellerId', 'name profilePhoto phone')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: listings });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createListing = async (req, res) => {
  try {
    const { title, description, price, category, contactPhone, condition, isNegotiable } = req.body;
    const images = req.files ? req.files.map(f => f.url) : [];

    const listing = await MarketplaceListing.create({
      estateId: req.estateId,
      sellerId: req.user._id,
      title,
      description,
      price: parseFloat(price) || 0,
      category,
      condition: condition || 'good',
      isNegotiable: isNegotiable === 'true' || isNegotiable === true,
      contactPhone: contactPhone || req.user.phone || '',
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
    const { title, description, price, category, status, contactPhone, condition, isNegotiable } = req.body;

    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!listing) return res.status(404).json({ success: false, message: 'Not found' });

    const isOwner = listing.sellerId.toString() === req.user._id.toString();
    const isManager = ['estate_manager', 'super_admin'].includes(req.user.role);
    if (!isOwner && !isManager) return res.status(403).json({ success: false, message: 'Not authorized' });

    if (title !== undefined) listing.title = title;
    if (description !== undefined) listing.description = description;
    if (price !== undefined) listing.price = parseFloat(price);
    if (category !== undefined) listing.category = category;
    if (status !== undefined) listing.status = status;
    if (contactPhone !== undefined) listing.contactPhone = contactPhone;
    if (condition !== undefined) listing.condition = condition;
    if (isNegotiable !== undefined) listing.isNegotiable = isNegotiable === 'true' || isNegotiable === true;

    await listing.save();
    await listing.populate('sellerId', 'name profilePhoto phone');
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
    if (!isOwner && !isManager) return res.status(403).json({ success: false, message: 'Not authorized' });

    await listing.deleteOne();
    return res.json({ success: true, message: 'Listing deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.viewListing = async (req, res) => {
  try {
    const listing = await MarketplaceListing.findOneAndUpdate(
      { _id: req.params.id, estateId: req.estateId },
      { $inc: { views: 1 } },
      { new: true }
    ).populate('sellerId', 'name profilePhoto phone');
    if (!listing) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: listing });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.toggleSave = async (req, res) => {
  try {
    const listing = await MarketplaceListing.findOne({ _id: req.params.id, estateId: req.estateId });
    if (!listing) return res.status(404).json({ success: false, message: 'Not found' });

    const userId = req.user._id;
    const isSaved = listing.savedBy.some(id => id.toString() === userId.toString());

    if (isSaved) {
      listing.savedBy = listing.savedBy.filter(id => id.toString() !== userId.toString());
    } else {
      listing.savedBy.push(userId);
    }

    await listing.save();
    return res.json({ success: true, saved: !isSaved, data: listing });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
