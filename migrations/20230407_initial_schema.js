exports.up = async function(knex) {
  // Create movies table
  await knex.schema.createTable('movies', (table) => {
    table.increments('id').primary();
    table.integer('tmdb_id').notNullable().unique();
    table.string('imdb_id', 20).nullable();
    table.string('title', 255).notNullable();
    table.string('original_title', 255).nullable();
    table.text('overview').nullable();
    table.text('tagline').nullable();
    table.date('release_date').nullable();
    table.integer('runtime').nullable();
    table.bigInteger('budget').nullable();
    table.bigInteger('revenue').nullable();
    table.decimal('popularity', 10, 4).nullable();
    table.decimal('vote_average', 3, 1).nullable();
    table.integer('vote_count').nullable();
    table.boolean('adult').defaultTo(false);
    table.string('status', 50).nullable();
    table.string('homepage', 255).nullable();
    table.string('poster_path', 255).nullable();
    table.string('backdrop_path', 255).nullable();
    table.string('original_language', 10).nullable();
    table.timestamp('next_update_time').nullable();
    table.string('update_frequency').nullable();
    table.timestamp('last_full_update').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Create genres table
  await knex.schema.createTable('genres', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable().unique();
  });

  // Create movie_genres table
  await knex.schema.createTable('movie_genres', (table) => {
    table.integer('movie_id').unsigned().notNullable().references('id').inTable('movies').onDelete('CASCADE');
    table.integer('genre_id').unsigned().notNullable().references('id').inTable('genres').onDelete('CASCADE');
    table.primary(['movie_id', 'genre_id']);
  });

  // Create production_companies table
  await knex.schema.createTable('production_companies', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.string('logo_path', 255).nullable();
    table.string('origin_country', 2).nullable();
  });

  // Create movie_production_companies table
  await knex.schema.createTable('movie_production_companies', (table) => {
    table.integer('movie_id').unsigned().notNullable().references('id').inTable('movies').onDelete('CASCADE');
    table.integer('company_id').unsigned().notNullable().references('id').inTable('production_companies').onDelete('CASCADE');
    table.primary(['movie_id', 'company_id']);
  });

  // Create external_ids table
  await knex.schema.createTable('external_ids', (table) => {
    table.increments('id').primary();
    table.string('content_type', 10).notNullable();
    table.integer('content_id').notNullable();
    table.string('source', 50).notNullable();
    table.string('external_id', 100).notNullable();
    table.string('url', 255).nullable();
    table.decimal('confidence_score', 3, 2).nullable();
    table.timestamp('last_verified').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['content_type', 'content_id', 'source', 'external_id']);
  });

  // Create ratings table
  await knex.schema.createTable('ratings', (table) => {
    table.increments('id').primary();
    table.string('content_type', 10).notNullable();
    table.integer('content_id').notNullable();
    table.string('source', 50).notNullable();
    table.decimal('rating', 3, 1).nullable();
    table.integer('rating_count').nullable();
    table.integer('review_count').nullable();
    table.text('consensus').nullable();
    table.timestamp('last_updated').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['content_type', 'content_id', 'source']);
  });

  // Create watch_providers table
  await knex.schema.createTable('watch_providers', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.string('logo_path', 255).nullable();
    table.integer('priority').nullable();
  });

  // Create watch_links table
  await knex.schema.createTable('watch_links', (table) => {
    table.increments('id').primary();
    table.string('content_type', 10).notNullable();
    table.integer('content_id').notNullable();
    table.integer('provider_id').unsigned().notNullable().references('id').inTable('watch_providers').onDelete('CASCADE');
    table.string('country_code', 2).notNullable();
    table.string('link_type', 20).notNullable();
    table.string('url', 255).nullable();
    table.decimal('price', 10, 2).nullable();
    table.string('currency', 3).nullable();
    table.timestamp('last_verified').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['content_type', 'content_id', 'provider_id', 'country_code', 'link_type']);
  });

  // Create indexes
  await knex.schema.raw('CREATE INDEX idx_movies_tmdb_id ON movies(tmdb_id)');
  await knex.schema.raw('CREATE INDEX idx_movies_imdb_id ON movies(imdb_id)');
  await knex.schema.raw('CREATE INDEX idx_movies_release_date ON movies(release_date)');
  await knex.schema.raw('CREATE INDEX idx_movies_popularity ON movies(popularity)');
  await knex.schema.raw('CREATE INDEX idx_movies_next_update ON movies(next_update_time) WHERE next_update_time IS NOT NULL');
  
  await knex.schema.raw('CREATE INDEX idx_external_ids_content ON external_ids(content_type, content_id)');
  await knex.schema.raw('CREATE INDEX idx_external_ids_source ON external_ids(source)');
  
  await knex.schema.raw('CREATE INDEX idx_ratings_content ON ratings(content_type, content_id)');
  await knex.schema.raw('CREATE INDEX idx_ratings_source ON ratings(source)');
  
  await knex.schema.raw('CREATE INDEX idx_watch_links_content ON watch_links(content_type, content_id)');
  await knex.schema.raw('CREATE INDEX idx_watch_links_country ON watch_links(country_code)');
  await knex.schema.raw('CREATE INDEX idx_watch_links_provider ON watch_links(provider_id)');
};

exports.down = async function(knex) {
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('watch_links');
  await knex.schema.dropTableIfExists('watch_providers');
  await knex.schema.dropTableIfExists('ratings');
  await knex.schema.dropTableIfExists('external_ids');
  await knex.schema.dropTableIfExists('movie_production_companies');
  await knex.schema.dropTableIfExists('production_companies');
  await knex.schema.dropTableIfExists('movie_genres');
  await knex.schema.dropTableIfExists('genres');
  await knex.schema.dropTableIfExists('movies');
}; 