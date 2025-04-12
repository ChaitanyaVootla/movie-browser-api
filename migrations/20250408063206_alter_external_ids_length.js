'use strict';

/** @param {import('knex').Knex} knex */
exports.up = async function(knex) {
    await knex.schema.alterTable('external_ids', (table) => {
        table.string('external_id', 255).notNullable().alter();
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function(knex) {
    await knex.schema.alterTable('external_ids', (table) => {
        // Warning: Reverting this might truncate data if longer IDs were inserted.
        table.string('external_id', 100).notNullable().alter();
    });
}; 