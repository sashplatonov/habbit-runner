package com.sashplatonov.habbit.runner.integration;

import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
@TestProfile(PostgresTestProfile.class)
class FlywayMigrationIT {
  @Inject
  EntityManager entityManager;

  @Inject
  Flyway flyway;

  @Test
  void shouldApplyEveryMigrationToFreshPostgres() {
    var appliedVersions = entityManager.createNativeQuery(
        "SELECT version FROM flyway_schema_history WHERE success = TRUE ORDER BY installed_rank"
    ).getResultList();

    var expectedMigrationCount = Arrays.stream(flyway.info().all())
        .filter(migration -> migration.getVersion() != null)
        .count();
    var expectedCurrentVersion = flyway.info().current().getVersion().getVersion();

    assertEquals(expectedMigrationCount, appliedVersions.size());
    assertEquals(expectedCurrentVersion, appliedVersions.getLast().toString());
  }

  @Test
  void shouldPreserveConvertedHabitStorageAndCursorIndexes() {
    var scheduleType = entityManager.createNativeQuery(
        "SELECT data_type FROM information_schema.columns "
            + "WHERE table_schema = 'public' AND table_name = 'habits' AND column_name = 'schedule'"
    ).getSingleResult();
    var cursorIndexCount = ((Number) entityManager.createNativeQuery(
        "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' "
            + "AND indexname IN ('habits_user_updated_cursor_idx', 'checkins_user_updated_cursor_idx')"
    ).getSingleResult()).intValue();
    var dashboardPreferencesType = entityManager.createNativeQuery(
        "SELECT data_type FROM information_schema.columns "
            + "WHERE table_schema = 'public' AND table_name = 'users' "
            + "AND column_name = 'dashboardPreferences'"
    ).getSingleResult();

    assertEquals("text", scheduleType);
    assertEquals(2, cursorIndexCount);
    assertEquals("text", dashboardPreferencesType);
    assertTrue(tableExists("habit_schedule_weekdays"));
    assertTrue(constraintExists("habits_description_length"));
  }

  @Test
  @Transactional
  void shouldAddWorkspaceStorageWithDefaultsAndKeepLegacyPreferences() {
    var workspacePreferencesType = columnDataType("workspacePreferences");
    var workspacePreferencesRevisionType = columnDataType("workspacePreferencesRevision");
    var workspacePreferencesNullable = columnNullable("workspacePreferences");
    var workspacePreferencesRevisionNullable = columnNullable("workspacePreferencesRevision");
    var workspacePreferencesDefault = columnDefault("workspacePreferences");
    var workspacePreferencesRevisionDefault = columnDefault("workspacePreferencesRevision");
    var legacyPreferences = "{\"filter\":\"completed\"}";

    entityManager.createNativeQuery(
        "INSERT INTO users (id, email, theme, \"dashboardPreferences\") "
            + "VALUES (?1, ?2, ?3, ?4)"
    )
        .setParameter(1, "uws-002-legacy-user")
        .setParameter(2, "uws-002-legacy@example.com")
        .setParameter(3, "cloud")
        .setParameter(4, legacyPreferences)
        .executeUpdate();

    var storedLegacyPreferences = entityManager.createNativeQuery(
        "SELECT \"dashboardPreferences\" FROM users WHERE id = ?1"
    ).setParameter(1, "uws-002-legacy-user").getSingleResult();

    assertEquals("text", workspacePreferencesType);
    assertEquals("bigint", workspacePreferencesRevisionType);
    assertEquals("NO", workspacePreferencesNullable);
    assertEquals("NO", workspacePreferencesRevisionNullable);
    assertTrue(workspacePreferencesDefault.contains("{}"));
    assertEquals("0", workspacePreferencesRevisionDefault);
    assertEquals(legacyPreferences, storedLegacyPreferences);
  }

  private String columnDataType(String columnName) {
    return (String) entityManager.createNativeQuery(
        "SELECT data_type FROM information_schema.columns "
            + "WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ?1"
    ).setParameter(1, columnName).getSingleResult();
  }

  private String columnNullable(String columnName) {
    return (String) entityManager.createNativeQuery(
        "SELECT is_nullable FROM information_schema.columns "
            + "WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ?1"
    ).setParameter(1, columnName).getSingleResult();
  }

  private String columnDefault(String columnName) {
    return (String) entityManager.createNativeQuery(
        "SELECT column_default FROM information_schema.columns "
            + "WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ?1"
    ).setParameter(1, columnName).getSingleResult();
  }

  private boolean tableExists(String tableName) {
    return ((Number) entityManager.createNativeQuery(
        "SELECT COUNT(*) FROM information_schema.tables "
            + "WHERE table_schema = 'public' AND table_name = ?1"
    ).setParameter(1, tableName).getSingleResult()).intValue() == 1;
  }

  private boolean constraintExists(String constraintName) {
    return ((Number) entityManager.createNativeQuery(
        "SELECT COUNT(*) FROM pg_constraint WHERE conname = ?1"
    ).setParameter(1, constraintName).getSingleResult()).intValue() == 1;
  }
}
