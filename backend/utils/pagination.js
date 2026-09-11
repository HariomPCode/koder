const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const pageValue = Number.parseInt(query.page, 10);
  const limitValue = Number.parseInt(query.limit, 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : DEFAULT_PAGE;
  const limit = Number.isFinite(limitValue) && limitValue > 0
    ? Math.min(limitValue, maxLimit)
    : Math.min(defaultLimit, maxLimit);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function paginationResult({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  paginationResult,
};
