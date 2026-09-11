package com.sashplatonov.habbit.runner.auth.resource;

import com.sashplatonov.habbit.runner.auth.security.CurrentUserContext;
import com.sashplatonov.habbit.runner.auth.security.RequireAuth;
import com.sashplatonov.habbit.runner.auth.service.PreferencesService;
import com.sashplatonov.habbit.runner.auth.service.WorkspacePreferencesConflictException;
import com.sashplatonov.habbit.runner.api.ErrorResponse;
import com.sashplatonov.habbit.runner.auth.dto.UpdatePreferencesRequest;
import com.sashplatonov.habbit.runner.auth.dto.UserPreferencesResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponses;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

@Path("/auth/preferences")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Authentication")
public class AuthPreferencesResource {
  final PreferencesService preferencesService;
  final CurrentUserContext currentUserContext;

  AuthPreferencesResource(PreferencesService preferencesService, CurrentUserContext currentUserContext) {
    this.preferencesService = preferencesService;
    this.currentUserContext = currentUserContext;
  }

  @RequireAuth
  @GET
  @Operation(summary = "Get user preferences", description = "Returns the stored preferences for the authenticated user.")
  @APIResponses({
      @APIResponse(responseCode = "200", description = "User preferences",
          content = @Content(schema = @Schema(implementation = UserPreferencesResponse.class))),
      @APIResponse(responseCode = "403", description = "Authentication required",
          content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
      @APIResponse(responseCode = "409", description = "Workspace revision conflict",
          content = @Content(schema = @Schema(implementation = UserPreferencesResponse.class)))
  })
  public Response getPreferences() {
    return Response.ok(preferencesService.getUserPreferences(currentUserContext.requireUser().id())).build();
  }

  @RequireAuth
  @PUT
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Update user preferences", description = "Updates the stored preferences for the authenticated user.")
  @APIResponses({
      @APIResponse(responseCode = "200", description = "User preferences updated",
          content = @Content(schema = @Schema(implementation = UserPreferencesResponse.class))),
      @APIResponse(responseCode = "400", description = "Validation failed",
          content = @Content(schema = @Schema(implementation = ErrorResponse.class))),
      @APIResponse(responseCode = "403", description = "Authentication required",
          content = @Content(schema = @Schema(implementation = ErrorResponse.class)))
  })
  public Response updatePreferences(@Valid @NotNull UpdatePreferencesRequest request) {
    try {
      var updated = preferencesService.updateUserPreferences(
          currentUserContext.requireUser().id(), request);
      return Response.ok(updated).build();
    } catch (WorkspacePreferencesConflictException conflict) {
      return Response.status(Response.Status.CONFLICT).entity(conflict.current()).header("X-Error-Code", "PREFERENCES_CONFLICT").build();
    }
  }
}
