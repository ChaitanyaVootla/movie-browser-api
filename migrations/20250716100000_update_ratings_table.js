/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.alterTable('ratings', function (table) {
        // Add rating_type column
        table.string('rating_type', 20).notNullable().defaultTo('main').comment('e.g., main, critic, audience');
        
        // Add details column for JSONB data
        table.jsonb('details').nullable().comment('Store source-specific extras (certified, sentiment, etc.)');
        
        // Drop the old review_count column
        table.dropColumn('review_count');
        
        // Drop the old unique constraint
        // Note: Constraint names might differ based on DB/initial creation. Adjust if necessary.
        // Default constraint name format might be ratings_content_type_content_id_source_unique
        // Using columns directly might be more reliable if name is unknown.
        table.dropUnique(['content_type', 'content_id', 'source']);
        
        // Add the new unique constraint including rating_type
        table.unique(['content_type', 'content_id', 'source', 'rating_type'], { indexName: 'ratings_uq_content_source_type' });
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.alterTable('ratings', function (table) {
        // Drop the new unique constraint
        table.dropUnique(['content_type', 'content_id', 'source', 'rating_type'], { indexName: 'ratings_uq_content_source_type' });
        
        // Drop the new columns
        table.dropColumn('rating_type');
        table.dropColumn('details');
        
        // Add the review_count column back (assuming it was nullable integer)
        table.integer('review_count').nullable();
        
        // Add the old unique constraint back
        table.unique(['content_type', 'content_id', 'source'], { indexName: 'ratings_content_type_content_id_source_unique' }); // Use default naming or original name
    });
}; 