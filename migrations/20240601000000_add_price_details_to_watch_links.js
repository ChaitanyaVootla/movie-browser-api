/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('watch_links', function(table) {
    // Add raw_price column to store the original price string (e.g., "Subscription", "Free")
    table.string('raw_price').nullable();
    
    // Add boolean flags for subscription and free content
    table.boolean('is_subscription').defaultTo(false);
    table.boolean('is_free').defaultTo(false);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('watch_links', function(table) {
    table.dropColumn('raw_price');
    table.dropColumn('is_subscription');
    table.dropColumn('is_free');
  });
}; 