exports.up = async function(knex) {
    await knex.schema.alterTable('movies', (table) => {
        table.jsonb('credits').nullable().comment('Stores director and top 10 cast members');
    });
};

exports.down = async function(knex) {
    await knex.schema.alterTable('movies', (table) => {
        table.dropColumn('credits');
    });
}; 