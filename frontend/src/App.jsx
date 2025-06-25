import React, { useState, useEffect, useMemo } from "react";
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Container,
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  AppBar,
  Toolbar,
  IconButton,
  CircularProgress,
  Stack,
  useMediaQuery,
  useTheme,
  Chip,
  Autocomplete,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import AdvancedChart from "./AdvancedChart";
import axios from "axios";
import { useForm, Controller } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";

const schema = yup.object({
  amount: yup
    .number()
    .typeError("Amount must be a number")
    .required("Amount is required")
    .positive("Amount must be positive")
    .integer("Amount must be an integer"),
});

const TWELVE_DATA_API_KEY = import.meta.env.VITE_TWELVE_DATA_API_KEY;

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");
  useEffect(() => {
    localStorage.setItem("darkMode", darkMode.toString());
  }, [darkMode]);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: darkMode ? "dark" : "light",
          primary: { main: "#facc15" },
          background: { default: darkMode ? "#0f172a" : "#fff", paper: darkMode ? "#1e293b" : "#fff" },
        },
        typography: { fontFamily: "Poppins, Arial, sans-serif", fontWeightBold: 700 },
      }),
    [darkMode]
  );

  const muiTheme = useTheme();
  const isSmallScreen = useMediaQuery(muiTheme.breakpoints.down("sm"));

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: yupResolver(schema),
    defaultValues: { amount: 30 },
  });

  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem("favorites");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("favorites", JSON.stringify(favorites));
  }, [favorites]);

  const [autocompleteOptions, setAutocompleteOptions] = useState([]);
  const [autoLoading, setAutoLoading] = useState(false);
  const [selectedTickers, setSelectedTickers] = useState([]);

  const [chartType, setChartType] = useState("candlestick");

  const fetchTickerSuggestions = async (query) => {
    if (!query || query.length < 2) {
      setAutocompleteOptions([]);
      return;
    }
    setAutoLoading(true);
    try {
      const res = await axios.get("https://api.twelvedata.com/symbol_search", {
        params: { symbol: query, apikey: TWELVE_DATA_API_KEY },
      });
      const opts = (res.data.data || []).map((r) => ({
        label: `${r.name} (${r.symbol})`,
        symbol: r.symbol,
      }));
      setAutocompleteOptions(opts);
    } catch {
      setAutocompleteOptions([]);
    } finally {
      setAutoLoading(false);
    }
  };

  const [predictionData, setPredictionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchMultipleStocks = async (tickers, days) => {
    const response = await fetch("http://localhost:4000/api/stock-candles-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, days }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "API error");
    }
    const json = await response.json();
    return json.data;
  };

  const onSubmit = async (data) => {
    if (selectedTickers.length === 0) {
      setFetchError("Please select at least one ticker symbol");
      return;
    }
    setLoading(true);
    setFetchError(null);
    setPredictionData(null);

    try {
      const tickers = selectedTickers.map((t) => t.symbol || t);
      const result = await fetchMultipleStocks(tickers, data.amount);
      setPredictionData(result);

      const newFavs = tickers.filter((t) => !favorites.includes(t));
      if (newFavs.length) setFavorites((favs) => [...favs, ...newFavs]);
    } catch (error) {
      setFetchError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const removeFavorite = (ticker) => {
    setFavorites((favs) => favs.filter((f) => f !== ticker));
    setSelectedTickers((sel) => sel.filter((t) => (t.symbol || t) !== ticker));
  };

  const addFavoriteToSelection = (ticker) => {
    if (selectedTickers.find((t) => (t.symbol || t) === ticker)) return;
    setSelectedTickers((sel) => [...sel, { symbol: ticker, label: ticker }]);
  };

  const handleChartTypeChange = (event, newType) => {
    if (newType !== null) setChartType(newType);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <AppBar position="static" color="primary" enableColorOnDark>
          <Toolbar>
            <BoltIcon sx={{ mr: 1 }} />
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: "bold" }}>
              StockVision
            </Typography>
            <IconButton
              color="inherit"
              onClick={() => setDarkMode(!darkMode)}
              aria-label="toggle dark mode"
            >
              {darkMode ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Toolbar>
        </AppBar>

        <Container
          maxWidth="lg"
          sx={{
            mt: 6,
            mb: 6,
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            px: { xs: 2, sm: 3, md: 5 },
          }}
        >
          <Typography
            variant={isSmallScreen ? "h5" : "h4"}
            align="center"
            fontWeight="bold"
            gutterBottom
            color="primary"
          >
            Predict Your Stock’s Future Price
          </Typography>
          <Typography variant="body1" align="center" paragraph sx={{ maxWidth: "900px" }}>
            Select one or more ticker symbols and prediction horizon in days.
          </Typography>

          <Box sx={{ width: "100%", maxWidth: "600px", mx: "auto" }}>
            <Box
              component="form"
              noValidate
              onSubmit={handleSubmit(onSubmit)}
              sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 3, width: "100%" }}
            >
              <Autocomplete
                multiple
                options={autocompleteOptions}
                getOptionLabel={(option) => (typeof option === "string" ? option : option.label)}
                loading={autoLoading}
                filterOptions={(x) => x}
                onInputChange={(_, newInputValue) => {
                  if (newInputValue.length >= 2) {
                    fetchTickerSuggestions(newInputValue);
                  } else {
                    setAutocompleteOptions([]);
                  }
                }}
                onChange={(_, newValue) => setSelectedTickers(newValue)}
                value={selectedTickers}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Ticker Symbols"
                    placeholder="Start typing ticker symbol"
                    helperText="You can select multiple"
                    size="medium"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {autoLoading ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                    fullWidth
                  />
                )}
                size="medium"
              />

              <Controller
                name="amount"
                control={control}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Amount (days)"
                    variant="outlined"
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    fullWidth
                    autoComplete="off"
                    type="number"
                    inputProps={{ min: 1 }}
                    size="medium"
                  />
                )}
              />

              <Button
                variant="contained"
                type="submit"
                color="primary"
                disabled={loading}
                sx={{ fontWeight: "bold", py: 1.5, fontSize: "1.1rem" }}
                size="large"
              >
                {loading ? <CircularProgress size={26} color="inherit" /> : "Predict"}
              </Button>
            </Box>

            {fetchError && (
              <Alert severity="error" sx={{ mt: 4, width: "100%" }}>
                {fetchError}
              </Alert>
            )}

            {favorites.length > 0 && (
              <Box sx={{ mt: 4 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Favorites
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {favorites.map((fav) => (
                    <Chip
                      key={fav}
                      label={fav}
                      onClick={() => addFavoriteToSelection(fav)}
                      onDelete={() => removeFavorite(fav)}
                      color="primary"
                      variant="outlined"
                      sx={{ mb: 1 }}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Box>

          {predictionData && Object.keys(predictionData).length > 0 && (
            <>
              <Box
                sx={{
                  mt: 6,
                  p: 3,
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  borderRadius: 2,
                  textAlign: "center",
                  fontWeight: "bold",
                  fontSize: isSmallScreen ? "1.25rem" : "1.75rem",
                  boxShadow: 3,
                  width: "100%",
                  maxWidth: "900px",
                }}
              >
                Final Predicted Prices:
                <Box component="div" sx={{ mt: 1 }}>
                  {Object.entries(predictionData).map(([ticker, data]) => (
                    <Typography key={ticker} variant="body1" sx={{ lineHeight: 1.6 }}>
                      {ticker}: ${data[data.length - 1].close.toFixed(2)}
                    </Typography>
                  ))}
                </Box>
              </Box>

              <Box
                sx={{
                  mt: 4,
                  maxWidth: "900px",
                  width: "100%",
                  flexGrow: 1,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Typography
                  variant="h6"
                  gutterBottom
                  color="primary"
                  fontWeight="bold"
                  align="center"
                >
                  Prediction Chart
                </Typography>

                {/* Chart type toggle below the title */}
                <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
                  <ToggleButtonGroup
                    color="primary"
                    value={chartType}
                    exclusive
                    onChange={(e, val) => {
                      if (val !== null) setChartType(val);
                    }}
                    aria-label="chart type toggle"
                    size="small"
                  >
                    <ToggleButton value="candlestick">Candlestick</ToggleButton>
                    <ToggleButton value="line">Line</ToggleButton>
                  </ToggleButtonGroup>
                </Box>

                <AdvancedChart dataByTicker={predictionData} chartType={chartType} />
              </Box>
            </>
          )}
        </Container>

        <Box
          component="footer"
          sx={{
            py: 3,
            bgcolor: "background.paper",
            textAlign: "center",
            mt: "auto",
            boxShadow: "0 -2px 5px rgba(0,0,0,0.1)",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Created by - Meetkumar M. Gojiya
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}