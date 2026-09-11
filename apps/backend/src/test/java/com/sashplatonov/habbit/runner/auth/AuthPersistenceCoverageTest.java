package com.sashplatonov.habbit.runner.auth;

import com.sashplatonov.habbit.runner.auth.service.PreferencesService;
import com.sashplatonov.habbit.runner.auth.service.RefreshTokenService;
import com.sashplatonov.habbit.runner.auth.service.UserService;
import com.sashplatonov.habbit.runner.auth.support.RefreshTokenDigest;
import com.sashplatonov.habbit.runner.auth.dto.DashboardPreferences;
import com.sashplatonov.habbit.runner.auth.dto.DashboardWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.ProgressWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.UpdatePreferencesRequest;
import com.sashplatonov.habbit.runner.auth.dto.UserWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.dto.WorkspaceNavigation;
import com.sashplatonov.habbit.runner.auth.dto.WorkspaceScreen;
import com.sashplatonov.habbit.runner.auth.service.WorkspacePreferencesConflictException;
import com.sashplatonov.habbit.runner.model.HabitColor;
import com.sashplatonov.habbit.runner.model.HabitEntity;
import com.sashplatonov.habbit.runner.model.HabitFrequency;
import com.sashplatonov.habbit.runner.model.HabitType;
import com.sashplatonov.habbit.runner.model.RefreshTokenEntity;
import com.sashplatonov.habbit.runner.model.UserEntity;
import com.sashplatonov.habbit.runner.support.AuthenticatedApiTestSupport;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotAuthorizedException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
class AuthPersistenceCoverageTest extends AuthenticatedApiTestSupport {

  @Inject
  UserService userService;


  @Inject
  RefreshTokenService refreshTokenService;

  @Inject
  PreferencesService preferencesService;

  @Test
  void shouldCreateAndReuseUserThroughRealPersistenceService() throws Exception {
    var email = UUID.randomUUID() + "@example.test";

    var created = inTransaction(() -> userService.findOrCreateUser(email));
    var found = inTransaction(() -> userService.findOrCreateUser(email));

    assertNotNull(created.getId());
    assertEquals(email, created.getEmail());
    assertEquals("cloud", created.getTheme());
    assertEquals(created.getId(), found.getId());
    assertEquals(1L, UserEntity.count("email", email));
  }


  @Test
  void shouldCreateRequireAndRevokeRefreshTokensThroughRealPersistenceService() throws Exception {
    var user = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("cloud");
      entity.persist();
      return entity;
    });

    var token = "refresh-" + UUID.randomUUID();
    var createdToken = inTransaction(() -> refreshTokenService.create(token, user.getId(), 30));
    var active = inTransaction(() -> refreshTokenService.requireActive(token));
    inTransaction(() -> refreshTokenService.revoke(token));
    RefreshTokenEntity stored = inTransaction(() -> RefreshTokenEntity.<RefreshTokenEntity>find(
        "tokenHash",
        RefreshTokenDigest.hash(token)
    ).firstResult());

    assertEquals(token, createdToken);
    assertEquals(RefreshTokenDigest.hash(token), active.getTokenHash());
    assertEquals(user.getId(), stored.getUserId());
    assertTrue(stored.isRevoked());
    assertThrows(NotAuthorizedException.class, () -> inTransaction(() -> refreshTokenService.requireActive(token)));
  }

  @Test
  void shouldRotateRefreshTokensAndRevokeTheFamilyThroughRealPersistenceService() throws Exception {
    var user = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("cloud");
      entity.persist();
      return entity;
    });

    var token = "refresh-" + UUID.randomUUID();
    var createdToken = inTransaction(() -> refreshTokenService.create(token, user.getId(), 30));
    var rotatedToken = inTransaction(() -> refreshTokenService.rotate(refreshTokenService.requireActive(token), 30));
    RefreshTokenEntity oldStored = inTransaction(() -> RefreshTokenEntity.<RefreshTokenEntity>find(
        "tokenHash",
        RefreshTokenDigest.hash(token)
    ).firstResult());
    RefreshTokenEntity rotatedStored = inTransaction(() -> RefreshTokenEntity.<RefreshTokenEntity>find(
        "tokenHash",
        RefreshTokenDigest.hash(rotatedToken)
    ).firstResult());

    assertEquals(token, createdToken);
    assertNotEquals(token, rotatedToken);
    assertEquals(oldStored.getFamilyId(), rotatedStored.getFamilyId());
    assertTrue(oldStored.isRevoked());
    assertTrue(rotatedStored.isActiveAt(Instant.now()));

    inTransaction(() -> refreshTokenService.revoke(rotatedToken));

    RefreshTokenEntity revokedOld = inTransaction(() -> RefreshTokenEntity.<RefreshTokenEntity>find(
        "tokenHash",
        RefreshTokenDigest.hash(token)
    ).firstResult());
    RefreshTokenEntity revokedNew = inTransaction(() -> RefreshTokenEntity.<RefreshTokenEntity>find(
        "tokenHash",
        RefreshTokenDigest.hash(rotatedToken)
    ).firstResult());

    assertTrue(revokedOld.isRevoked());
    assertTrue(revokedNew.isRevoked());
  }

  @Test
  void shouldKeepUserCreatedAtStableAndAdvanceUpdatedAtWhenPreferencesChange() throws Exception {
    var initialCreatedAt = Instant.parse("2026-04-09T08:00:00Z");
    var initialUpdatedAt = Instant.parse("2026-04-09T08:05:00Z");
    var userId = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("cloud");
      entity.setTimezone("Europe/Berlin");
      entity.markCreatedAt(initialCreatedAt);
      entity.setUpdatedAt(initialUpdatedAt);
      entity.persist();
      return entity.getId();
    });

    inTransaction(() -> preferencesService.updateUserPreferences(
        userId,
        new UpdatePreferencesRequest("matrix", "America/New_York")
    ));

    UserEntity stored = inTransaction(() -> UserEntity.<UserEntity>findById(userId));

    assertEquals(initialCreatedAt, stored.createdAtValue());
    assertTrue(stored.updatedAtValue().isAfter(initialUpdatedAt));
  }

  @Test
  void shouldKeepRefreshTokenCreatedAtStableAndAdvanceUpdatedAtWhenRevoked() throws Exception {
    var initialCreatedAt = Instant.parse("2026-04-09T08:00:00Z");
    var initialUpdatedAt = Instant.parse("2026-04-09T08:05:00Z");
    var userId = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("cloud");
      entity.persist();
      return entity.getId();
    });
    var token = "refresh-" + UUID.randomUUID();

    inTransaction(() -> {
      var entity = new RefreshTokenEntity();
      entity.setTokenHash(RefreshTokenDigest.hash(token));
      entity.setFamilyId("family-" + UUID.randomUUID());
      entity.setUserId(userId);
      entity.setRevoked(false);
      entity.setCreatedAt(initialCreatedAt);
      entity.setUpdatedAt(initialUpdatedAt);
      entity.setExpiresAt(Instant.parse("2026-05-09T08:00:00Z"));
      entity.persist();
    });

    inTransaction(() -> refreshTokenService.revoke(token));

    RefreshTokenEntity stored = inTransaction(() -> RefreshTokenEntity.<RefreshTokenEntity>find(
        "tokenHash",
        RefreshTokenDigest.hash(token)
    ).firstResult());

    assertEquals(initialCreatedAt, stored.createdAtValue());
    assertTrue(stored.updatedAtValue().isAfter(initialUpdatedAt));
    assertTrue(stored.isRevoked());
  }

  @Test
  void shouldReadAndUpdatePreferencesThroughRealPersistenceService() throws Exception {
    var user = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("unsupported-theme");
      entity.setTimezone("Europe/Berlin");
      entity.markCreatedAt(Instant.now());
      entity.persist();
      return entity;
    });

    var current = inTransaction(() -> preferencesService.getUserPreferences(user.getId()));
    var updated = inTransaction(() -> preferencesService.updateUserPreferences(
        user.getId(),
        new UpdatePreferencesRequest("matrix", " ")
    ));
    var unchangedTimezone = inTransaction(() -> preferencesService.updateUserPreferences(
        user.getId(),
        new UpdatePreferencesRequest("matrix", null)
    ));

    assertEquals("cloud", current.theme());
    assertEquals("Europe/Berlin", current.timezone());
    assertEquals("matrix", updated.theme());
    assertNull(updated.timezone());
    assertNull(unchangedTimezone.timezone());
  }

  @Test
  void shouldNormalizeDashboardPreferencesAndPreserveThemForLegacyClients() throws Exception {
    var user = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("cloud");
      entity.persist();
      return entity;
    });
    var requestedDashboard = new DashboardPreferences(
        99,
        "unsupported",
        List.of(" focus ", "focus", "x".repeat(41)),
        "unsupported",
        "compact",
        Map.of("cloud", 4, "broken", -1)
    );

    var updated = inTransaction(() -> preferencesService.updateUserPreferences(
        user.getId(),
        new UpdatePreferencesRequest("matrix", "Europe/Belgrade", requestedDashboard)
    ));
    var legacyUpdated = inTransaction(() -> preferencesService.updateUserPreferences(
        user.getId(),
        new UpdatePreferencesRequest("sakura", null)
    ));

    assertEquals("pending", updated.dashboard().filter());
    assertEquals(List.of("focus"), updated.dashboard().tags());
    assertEquals("custom", updated.dashboard().sort());
    assertEquals("compact", updated.dashboard().density());
    assertEquals(Map.of("cloud", 4), updated.dashboard().themeUsage());
    assertEquals(updated.dashboard(), legacyUpdated.dashboard());
  }

  @Test
  void shouldIncrementWorkspaceRevisionAndRejectStaleCanonicalUpdate() throws Exception {
    var user = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("cloud");
      entity.persist();
      return entity;
    });

    var current = inTransaction(() -> preferencesService.getUserPreferences(user.getId()));
    var updated = inTransaction(() -> preferencesService.updateUserPreferences(user.getId(),
        new UpdatePreferencesRequest("matrix", null, null, new UserWorkspacePreferences(), current.revision())));

    assertEquals(current.revision() + 1, updated.revision());
    assertThrows(WorkspacePreferencesConflictException.class, () -> inTransaction(
        () -> preferencesService.updateUserPreferences(user.getId(),
            new UpdatePreferencesRequest("sakura", null, null, new UserWorkspacePreferences(), current.revision()))));
    assertEquals("matrix", inTransaction(() -> UserEntity.<UserEntity>findById(user.getId())).getTheme());
  }

  @Test
  void shouldRejectIncompleteCanonicalUpdatesWithoutChangingStoredPreferences() throws Exception {
    var user = inTransaction(() -> {
      var entity = new UserEntity();
      entity.setEmail(UUID.randomUUID() + "@example.test");
      entity.setTheme("matrix");
      entity.setTimezone("Europe/Berlin");
      entity.persist();
      return entity;
    });
    var current = inTransaction(() -> preferencesService.getUserPreferences(user.getId()));
    var requestedWorkspace = new UserWorkspacePreferences();

    assertThrows(BadRequestException.class, () -> inTransaction(() -> preferencesService.updateUserPreferences(
        user.getId(), new UpdatePreferencesRequest("sakura", "America/New_York", null,
            null, current.revision()))));
    assertThrows(BadRequestException.class, () -> inTransaction(() -> preferencesService.updateUserPreferences(
        user.getId(), new UpdatePreferencesRequest("sakura", "America/New_York", null,
            requestedWorkspace, null))));

    var unchanged = inTransaction(() -> preferencesService.getUserPreferences(user.getId()));
    assertEquals("matrix", unchanged.theme());
    assertEquals("Europe/Berlin", unchanged.timezone());
    assertEquals(current.workspace(), unchanged.workspace());
    assertEquals(current.revision(), unchanged.revision());
  }

  @Test
  void shouldPersistSelectedHabitCleanupOnceAfterHabitDeletion() throws Exception {
    var habitId = UUID.randomUUID().toString();
    var userId = inTransaction(() -> {
      var user = new UserEntity();
      user.setEmail(UUID.randomUUID() + "@example.test");
      user.setTheme("cloud");
      user.persist();

      var habit = new HabitEntity();
      habit.setId(habitId);
      habit.setUserId(user.getId());
      habit.setName("Selected habit");
      habit.setColor(HabitColor.BLUE);
      habit.setIcon("target");
      habit.setFrequency(HabitFrequency.DAILY);
      habit.setDailyTarget(1);
      habit.setTargetStreak(1);
      habit.setArchived(false);
      habit.setType(HabitType.POSITIVE);
      habit.setSortOrder(BigInteger.ZERO);
      habit.persist();
      return user.getId();
    });
    var initial = inTransaction(() -> preferencesService.getUserPreferences(userId));
    var selectedWorkspace = new UserWorkspacePreferences(1, new DashboardWorkspacePreferences(),
        new ProgressWorkspacePreferences(), new WorkspaceNavigation(WorkspaceScreen.HABIT_DETAIL, habitId), List.of());
    var selected = inTransaction(() -> preferencesService.updateUserPreferences(userId,
        new UpdatePreferencesRequest("cloud", null, null, selectedWorkspace, initial.revision())));
    var foreignWorkspace = new UserWorkspacePreferences(1, new DashboardWorkspacePreferences(),
        new ProgressWorkspacePreferences(), new WorkspaceNavigation(WorkspaceScreen.HABIT_DETAIL,
        UUID.randomUUID().toString()), List.of());

    assertEquals(WorkspaceScreen.HABIT_DETAIL, selected.workspace().navigation().screen());
    assertEquals(habitId, selected.workspace().navigation().selectedHabitId());
    assertThrows(BadRequestException.class, () -> inTransaction(() -> preferencesService.updateUserPreferences(userId,
        new UpdatePreferencesRequest("cloud", null, null, foreignWorkspace, selected.revision()))));

    inTransaction(() -> HabitEntity.deleteById(habitId));
    var cleaned = inTransaction(() -> preferencesService.getUserPreferences(userId));
    var stored = inTransaction(() -> UserEntity.<UserEntity>findById(userId));
    var cleanedAgain = inTransaction(() -> preferencesService.getUserPreferences(userId));

    assertEquals(WorkspaceScreen.DASHBOARD, cleaned.workspace().navigation().screen());
    assertNull(cleaned.workspace().navigation().selectedHabitId());
    assertEquals(selected.revision() + 1, cleaned.revision());
    assertFalse(stored.getWorkspacePreferences().contains(habitId));
    assertEquals(cleaned.revision(), cleanedAgain.revision());
  }
}
