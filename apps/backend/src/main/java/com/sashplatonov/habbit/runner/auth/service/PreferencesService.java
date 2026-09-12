package com.sashplatonov.habbit.runner.auth.service;

import com.sashplatonov.habbit.runner.auth.dto.DashboardPreferences;
import com.sashplatonov.habbit.runner.auth.dto.UpdatePreferencesRequest;
import com.sashplatonov.habbit.runner.auth.dto.UserPreferencesResponse;
import com.sashplatonov.habbit.runner.auth.dto.UserWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.support.ThemeCatalog;
import com.sashplatonov.habbit.runner.model.UserEntity;
import com.sashplatonov.habbit.runner.repository.HabitRepository;
import com.sashplatonov.habbit.runner.repository.UserRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotAuthorizedException;
import lombok.extern.slf4j.Slf4j;

import java.util.LinkedHashMap;
import java.util.Objects;

@ApplicationScoped
@Slf4j
public class PreferencesService {
  private final UserRepository userRepository;
  private final HabitRepository habitRepository;
  private final WorkspacePreferencesCodec codec;

  public PreferencesService() { this(null, null, new WorkspacePreferencesCodec()); }

  public PreferencesService(UserRepository userRepository) { this(userRepository, null, new WorkspacePreferencesCodec()); }

  @jakarta.inject.Inject
  PreferencesService(UserRepository userRepository, HabitRepository habitRepository,
                     WorkspacePreferencesCodec codec) {
    this.userRepository = userRepository;
    this.habitRepository = habitRepository;
    this.codec = codec;
  }

  @Transactional
  public UserPreferencesResponse getUserPreferences(String userId) {
    var user = findUserByIdForUpdate(userId);
    if (user == null) {
      throw new NotAuthorizedException("User no longer exists");
    }
    var storedWorkspace = readOrMigrate(user);
    var workspace = clearMissingSelectedHabit(userId, storedWorkspace);
    if (!Objects.equals(storedWorkspace, workspace)) {
      persistMigration(user, workspace);
    }
    return response(user, workspace);
  }

  @Transactional
  public UserPreferencesResponse updateUserPreferences(String userId, UpdatePreferencesRequest request) {
    PreferencesUpdateSupport.requireCanonicalWorkspaceAndRevisionTogether(request);
    if (request.workspace() != null) {
      return updateCanonical(userId, request);
    }
    var user = findUserByIdForUpdate(userId);
    PreferencesUpdateSupport.requireExistingUser(user);
    var workspace = clearMissingSelectedHabit(userId, readOrMigrate(user));
    workspace = updateLegacyPreferences(user, request, workspace);
    return response(user, workspace);
  }

  private UserPreferencesResponse updateCanonical(String userId, UpdatePreferencesRequest request) {
    var user = findUserByIdForUpdate(userId);
    PreferencesUpdateSupport.requireExistingUser(user);
    PreferencesUpdateSupport.requireValidRevision(request.revision());
    var currentWorkspace = clearMissingSelectedHabit(userId, readOrMigrate(user));
    requireCurrentRevision(request.revision(), user, currentWorkspace);
    var workspace = WorkspacePreferencesNormalizer.normalize(request.workspace());
    validateSelectedHabit(userId, workspace);
    PreferencesUpdateSupport.persistWorkspace(user, workspace, codec);
    PreferencesUpdateSupport.updateOptionalProfilePreferences(user, request);
    return response(user, workspace);
  }

  private UserWorkspacePreferences updateLegacyPreferences(UserEntity user, UpdatePreferencesRequest request,
                                                           UserWorkspacePreferences workspace) {
    var updatedWorkspace = request.dashboard() == null ? workspace
        : WorkspacePreferencesNormalizer.normalize(codec.fromLegacy(request.dashboard()));
    var previousTheme = ThemeCatalog.normalize(user.getTheme());
    var previousTimezone = user.getTimezone();
    user.setTheme(ThemeCatalog.normalize(request.theme()));
    PreferencesUpdateSupport.updateTimezoneIfPresent(user, request.timezone());
    PreferencesUpdateSupport.persistWorkspace(user, updatedWorkspace, codec);
    log.info("User preferences updated: userId={}, themeChanged={}, timezoneChanged={}", user.getId(),
        !Objects.equals(previousTheme, user.getTheme()), !Objects.equals(previousTimezone, user.getTimezone()));
    return updatedWorkspace;
  }

  private void requireCurrentRevision(Long revision, UserEntity user, UserWorkspacePreferences workspace) {
    if (!Objects.equals(revision, user.getWorkspacePreferencesRevision())) {
      throw new WorkspacePreferencesConflictException(response(user, workspace));
    }
  }

  private UserWorkspacePreferences readOrMigrate(UserEntity user) {
    if (user.getWorkspacePreferences() != null && !user.getWorkspacePreferences().isBlank()
        && !user.getWorkspacePreferences().trim().equals("{}")) {
      try {
        return WorkspacePreferencesNormalizer.normalize(codec.read(user.getWorkspacePreferences()));
      } catch (IllegalArgumentException exception) {
        log.warn("Invalid workspace preferences payload; using defaults: userId={}", user.getId());
        return persistMigration(user, WorkspacePreferencesNormalizer.defaults());
      }
    }
    return persistMigration(user, WorkspacePreferencesNormalizer.normalize(
        codec.fromLegacy(readLegacy(user.getDashboardPreferences()))));
  }

  private UserWorkspacePreferences persistMigration(UserEntity user, UserWorkspacePreferences workspace) {
    user.setWorkspacePreferences(codec.write(workspace));
    user.setWorkspacePreferencesRevision(nextRevision(user));
    return workspace;
  }

  private DashboardPreferences readLegacy(String value) {
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().readValue(
          value == null || value.isBlank() ? "{}" : value, DashboardPreferences.class);
    } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
      log.warn("Invalid historic dashboard preferences payload; using defaults");
      return new DashboardPreferences();
    }
  }

  private UserWorkspacePreferences clearMissingSelectedHabit(String userId, UserWorkspacePreferences workspace) {
    var navigation = workspace.navigation();
    if (navigation.selectedHabitId() != null
        && (habitRepository == null
        || habitRepository.findByIdAndUserId(navigation.selectedHabitId(), userId) == null)) {
      return new UserWorkspacePreferences(workspace.version(), workspace.dashboard(), workspace.progress(),
          new com.sashplatonov.habbit.runner.auth.dto.WorkspaceNavigation(), workspace.themeUsage());
    }
    return workspace;
  }

  private void validateSelectedHabit(String userId, UserWorkspacePreferences workspace) {
    if (workspace.navigation().selectedHabitId() != null && habitRepository != null
        && habitRepository.findByIdAndUserId(workspace.navigation().selectedHabitId(), userId) == null) {
      throw new BadRequestException("Selected habit is not available");
    }
  }

  private long nextRevision(UserEntity user) {
    return (user.getWorkspacePreferencesRevision() == null ? 0L : user.getWorkspacePreferencesRevision()) + 1L;
  }

  private UserPreferencesResponse response(UserEntity user, UserWorkspacePreferences workspace) {
    var usage = new LinkedHashMap<String, Integer>();
    workspace.themeUsage().forEach(entry -> usage.put(entry.theme().wireValue(), entry.count()));
    var dashboard = workspace.dashboard();
    var legacy = new DashboardPreferences(1, dashboard.filter().wireValue(), dashboard.tags(),
        dashboard.sort().wireValue(), dashboard.density().wireValue(), usage);
    return new UserPreferencesResponse(ThemeCatalog.normalize(user.getTheme()), user.getTimezone(),
        legacy, workspace, user.getWorkspacePreferencesRevision());
  }

  protected UserEntity findUserById(String userId) {
    return userRepository == null ? UserEntity.<UserEntity>findById(userId) : userRepository.findRequiredById(userId);
  }

  protected UserEntity findUserByIdForUpdate(String userId) {
    return userRepository == null ? findUserById(userId) : userRepository.findRequiredByIdForUpdate(userId);
  }
}
